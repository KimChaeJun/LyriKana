from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db, init_database
from app.routers.lyrics import legacy_router, router
from app.services.jobs import processor


logging.basicConfig(
    level=getattr(logging, settings.log_level, logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)


def create_app(*, initialize_database: bool = True) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        if initialize_database:
            init_database()
            processor.recover_incomplete()
        yield
        await processor.shutdown()

    application = FastAPI(title="LyriKana Backend", version="1.0.0", lifespan=lifespan)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_origin_regex=r"chrome-extension://.*",
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    application.include_router(router)
    application.include_router(legacy_router)

    @application.get("/")
    def root():
        return {"message": "LyriKana backend is running", "docs": "/docs"}

    @application.get("/health")
    def health(db: Session = Depends(get_db)):
        try:
            db.execute(text("SELECT 1"))
        except Exception as error:
            raise HTTPException(status_code=503, detail="database_unavailable") from error
        return {"status": "ok"}

    return application


app = create_app()
