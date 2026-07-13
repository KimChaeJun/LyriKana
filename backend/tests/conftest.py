from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import create_app
from app.services import jobs


@pytest.fixture
def api_client(tmp_path, monkeypatch):
    database_path = tmp_path / "test.db"
    test_engine = create_engine(
        f"sqlite:///{database_path}",
        connect_args={"check_same_thread": False},
    )
    test_session = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)
    Base.metadata.create_all(test_engine)
    monkeypatch.setattr(jobs, "SessionLocal", test_session)

    app = create_app(initialize_database=False)

    def override_get_db():
        with test_session() as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as client:
        yield client, test_session

    Base.metadata.drop_all(test_engine)
    test_engine.dispose()
