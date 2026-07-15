from __future__ import annotations


PREFLIGHT_HEADERS = {
    "Origin": "https://music.youtube.com",
    "Access-Control-Request-Method": "POST",
    "Access-Control-Request-Headers": "content-type",
    "Access-Control-Request-Private-Network": "true",
}


def test_youtube_music_private_network_preflight_is_allowed(api_client):
    client, _test_session = api_client

    response = client.options("/api/v1/songs/resolve", headers=PREFLIGHT_HEADERS)

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://music.youtube.com"
    assert response.headers["access-control-allow-private-network"] == "true"
    assert "POST" in response.headers["access-control-allow-methods"]
    assert "content-type" in response.headers["access-control-allow-headers"].lower()


def test_unrelated_web_origin_remains_blocked(api_client):
    client, _test_session = api_client
    headers = {**PREFLIGHT_HEADERS, "Origin": "https://example.com"}

    response = client.options("/api/v1/songs/resolve", headers=headers)

    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers
