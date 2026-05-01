from __future__ import annotations

import dataclasses
from typing import Any


@dataclasses.dataclass
class Experiment:
    id: str
    name: str
    description: str | None
    created_at: str

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Experiment":
        return cls(
            id=data["id"],
            name=data["name"],
            description=data.get("description"),
            created_at=data.get("created_at", ""),
        )


@dataclasses.dataclass
class Run:
    id: str
    experiment_id: str | None
    experiment_name: str
    run_name: str | None
    status: str
    params: dict[str, Any]
    metrics: dict[str, Any]
    started_at: str
    finished_at: str | None
    notes: str | None
    created_at: str

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Run":
        return cls(
            id=data["id"],
            experiment_id=data.get("experiment_id"),
            experiment_name=data["experiment_name"],
            run_name=data.get("run_name"),
            status=data.get("status", "completed"),
            params=data.get("params") or {},
            metrics=data.get("metrics") or {},
            started_at=data.get("started_at", ""),
            finished_at=data.get("finished_at"),
            notes=data.get("notes"),
            created_at=data.get("created_at", ""),
        )
