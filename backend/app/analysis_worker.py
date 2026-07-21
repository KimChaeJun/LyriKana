from __future__ import annotations

import argparse
import logging

from app.config import settings
from app.database import SessionLocal, init_database
from app.services.analysis_worker import AnalysisWorker


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the LyriKana karaoke analysis worker")
    parser.add_argument(
        "--once",
        action="store_true",
        help="Process at most one queued job and exit",
    )
    parser.add_argument("--worker-id", default=None)
    arguments = parser.parse_args()

    logging.basicConfig(
        level=getattr(logging, settings.log_level, logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    init_database()
    worker = AnalysisWorker(
        session_factory=SessionLocal,
        configuration=settings,
        worker_id=arguments.worker_id,
    )
    try:
        worker.run(once=arguments.once)
    except KeyboardInterrupt:
        logging.getLogger(__name__).info("Analysis worker stopped")


if __name__ == "__main__":
    main()
