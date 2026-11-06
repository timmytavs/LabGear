
"""LabGear Backend Step 40: FastAPI database session dependency.

Reuses the existing SQLAlchemy engine from app.db.database.

Each request receives a new Session. A service must explicitly commit an
approved transaction; this dependency never commits automatically. Uncommitted
work is rolled back when the Session closes. Errors also trigger a rollback.

Importing this module does not connect to PostgreSQL or modify any tables.
"""

from collections.abc import Generator
from typing import Annotated

from fastapi import Depends
from sqlalchemy.orm import Session

from app.db.database import engine


def get_db() -> Generator[Session, None, None]:
    """Provide a SQLAlchemy Session to one FastAPI request.

    Usage in a future endpoint:
        def endpoint(db: DbSession):
            ...

    Service functions remain responsible for calling db.commit() only after
    their validation, authorization, and transaction checks succeed.
    """
    with Session(bind=engine, autoflush=False, expire_on_commit=False) as db:
        try:
            yield db
        except Exception:
            db.rollback()
            raise


DbSession = Annotated[Session, Depends(get_db)]
