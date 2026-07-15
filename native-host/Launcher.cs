using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;

namespace LyriKana.NativeHost
{
    internal static class Launcher
    {
        private const string MutexName = "Local\\LyriKanaElectronLauncher";
        private const string ElectronHealthUrl = "http://127.0.0.1:17654/health";

        [STAThread]
        private static int Main(string[] args)
        {
            try
            {
                string message = ReadMessage();
                if (message.IndexOf("\"command\":\"ensureElectron\"", StringComparison.Ordinal) < 0)
                {
                    WriteResponse(true, "host-ready", null);
                    return 0;
                }

                using (Mutex mutex = new Mutex(false, MutexName))
                {
                    bool acquired;
                    try
                    {
                        acquired = mutex.WaitOne(TimeSpan.FromSeconds(8));
                    }
                    catch (AbandonedMutexException)
                    {
                        acquired = true;
                    }

                    if (!acquired)
                    {
                        WriteResponse(false, "busy", "launcher_mutex_timeout");
                        return 1;
                    }

                    try
                    {
                        string root = GetProjectRoot();
                        LoadEnvironment(Path.Combine(root, ".env"));

                        string backendHealthUrl = GetBackendHealthUrl();
                        bool backendWasHealthy = IsHealthy(backendHealthUrl);
                        bool electronWasHealthy = IsHealthy(ElectronHealthUrl);
                        bool backendStarted = false;
                        bool electronStarted = false;
                        string backendError = null;
                        string electronError = null;

                        if (!backendWasHealthy)
                        {
                            backendStarted = StartBackend(root, out backendError);
                        }

                        bool backendReady = backendWasHealthy
                            || (backendStarted && WaitForHealth(backendHealthUrl, TimeSpan.FromSeconds(15)));

                        if (!electronWasHealthy)
                        {
                            electronStarted = StartElectron(root, out electronError);
                        }

                        bool electronReady = electronWasHealthy
                            || (electronStarted && WaitForHealth(ElectronHealthUrl, TimeSpan.FromSeconds(7)));
                        bool ready = backendReady && electronReady;
                        string state = backendWasHealthy && electronWasHealthy
                            ? "already-running"
                            : ready ? "started" : "starting";
                        string error = !backendReady
                            ? (backendError ?? "backend_not_ready")
                            : !electronReady ? (electronError ?? "electron_not_ready") : null;

                        WriteResponse(ready, state, error);
                        return ready ? 0 : 1;
                    }
                    finally
                    {
                        mutex.ReleaseMutex();
                    }
                }
            }
            catch (Exception error)
            {
                WriteResponse(false, "error", error.GetType().Name);
                return 1;
            }
        }

        private static string ReadMessage()
        {
            Stream input = Console.OpenStandardInput();
            byte[] lengthBytes = ReadExact(input, 4);
            int length = BitConverter.ToInt32(lengthBytes, 0);
            if (length < 0 || length > 64 * 1024 * 1024)
            {
                throw new InvalidDataException("Invalid native message length");
            }
            return Encoding.UTF8.GetString(ReadExact(input, length));
        }

        private static byte[] ReadExact(Stream stream, int length)
        {
            byte[] buffer = new byte[length];
            int offset = 0;
            while (offset < length)
            {
                int read = stream.Read(buffer, offset, length - offset);
                if (read <= 0) throw new EndOfStreamException();
                offset += read;
            }
            return buffer;
        }

        private static void WriteResponse(bool ok, string state, string error)
        {
            string json = "{\"ok\":" + (ok ? "true" : "false")
                + ",\"state\":\"" + Escape(state) + "\""
                + (error == null ? "" : ",\"error\":\"" + Escape(error) + "\"")
                + "}";
            byte[] payload = Encoding.UTF8.GetBytes(json);
            Stream output = Console.OpenStandardOutput();
            byte[] length = BitConverter.GetBytes(payload.Length);
            output.Write(length, 0, length.Length);
            output.Write(payload, 0, payload.Length);
            output.Flush();
        }

        private static string Escape(string value)
        {
            return (value ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"");
        }

        private static string GetProjectRoot()
        {
            return Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", ".."));
        }

        private static string GetBackendHealthUrl()
        {
            string configuredUrl = Environment.GetEnvironmentVariable("LYRIKANA_BACKEND_URL");
            if (!string.IsNullOrWhiteSpace(configuredUrl))
            {
                return configuredUrl.TrimEnd('/') + "/health";
            }

            string port = Environment.GetEnvironmentVariable("PORT");
            if (string.IsNullOrWhiteSpace(port)) port = "8000";
            return "http://127.0.0.1:" + port + "/health";
        }

        private static bool StartBackend(string root, out string error)
        {
            string backendRoot = Path.Combine(root, "backend");
            string backendPython = Path.Combine(backendRoot, ".venv", "Scripts", "python.exe");
            string rootPython = Path.Combine(root, ".venv", "Scripts", "python.exe");
            string python = File.Exists(backendPython)
                ? backendPython
                : File.Exists(rootPython) ? rootPython : null;
            if (python == null)
            {
                error = "backend_python_not_installed";
                return false;
            }

            string host = Environment.GetEnvironmentVariable("HOST");
            if (string.IsNullOrWhiteSpace(host)) host = "127.0.0.1";
            string port = Environment.GetEnvironmentVariable("PORT");
            if (string.IsNullOrWhiteSpace(port)) port = "8000";

            ProcessStartInfo startInfo = new ProcessStartInfo();
            startInfo.FileName = python;
            startInfo.Arguments = "-m uvicorn app.main:app --host " + QuoteArgument(host)
                + " --port " + QuoteArgument(port);
            startInfo.WorkingDirectory = backendRoot;
            startInfo.UseShellExecute = true;
            startInfo.WindowStyle = ProcessWindowStyle.Hidden;

            Process process = Process.Start(startInfo);
            if (process == null)
            {
                error = "backend_start_failed";
                return false;
            }

            error = null;
            return true;
        }

        private static bool StartElectron(string root, out string error)
        {
            string electronRoot = Path.Combine(root, "ElectronOverlay");
            string electronExe = Path.Combine(electronRoot, "node_modules", "electron", "dist", "electron.exe");
            if (!File.Exists(electronExe))
            {
                error = "electron_not_installed";
                return false;
            }

            ProcessStartInfo startInfo = new ProcessStartInfo();
            startInfo.FileName = electronExe;
            startInfo.Arguments = ".";
            startInfo.WorkingDirectory = electronRoot;
            startInfo.UseShellExecute = false;
            startInfo.CreateNoWindow = true;

            Process process = Process.Start(startInfo);
            if (process == null)
            {
                error = "electron_start_failed";
                return false;
            }

            error = null;
            return true;
        }

        private static string QuoteArgument(string value)
        {
            return "\"" + (value ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
        }

        private static void LoadEnvironment(string path)
        {
            if (!File.Exists(path)) return;
            foreach (string rawLine in File.ReadAllLines(path, Encoding.UTF8))
            {
                string line = rawLine.Trim();
                if (line.Length == 0 || line.StartsWith("#")) continue;
                int separator = line.IndexOf('=');
                if (separator <= 0) continue;
                string name = line.Substring(0, separator).Trim();
                string value = line.Substring(separator + 1).Trim();
                if (name.Length > 0 && string.IsNullOrEmpty(Environment.GetEnvironmentVariable(name)))
                {
                    Environment.SetEnvironmentVariable(name, value);
                }
            }
        }

        private static bool WaitForHealth(string url, TimeSpan timeout)
        {
            Stopwatch stopwatch = Stopwatch.StartNew();
            while (stopwatch.Elapsed < timeout)
            {
                if (IsHealthy(url)) return true;
                Thread.Sleep(150);
            }
            return IsHealthy(url);
        }

        private static bool IsHealthy(string url)
        {
            try
            {
                HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url);
                request.Method = "GET";
                request.Timeout = 700;
                request.ReadWriteTimeout = 700;
                using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                {
                    return response.StatusCode == HttpStatusCode.OK;
                }
            }
            catch
            {
                return false;
            }
        }
    }
}
