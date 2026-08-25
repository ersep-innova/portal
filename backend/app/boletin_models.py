from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field, field_validator


DEFAULT_REGULATORY_TERMS = [
    "tarifaria",
    "cuadro tarifario",
    "incremento",
    "aumento",
    "cargo tarifario",
    "audiencia pública",
]


class AlertaCreate(BaseModel):
    nombre: str = Field(min_length=2, max_length=180)
    aliases: str = Field(default="", max_length=1500)
    active: bool = True

    @field_validator("nombre", "aliases", mode="before")
    @classmethod
    def strip_text(cls, value):
        return str(value or "").strip()


class AlertaUpdate(BaseModel):
    nombre: str = Field(min_length=2, max_length=180)
    aliases: str = Field(default="", max_length=1500)
    active: bool = True

    @field_validator("nombre", "aliases", mode="before")
    @classmethod
    def strip_text(cls, value):
        return str(value or "").strip()


class AlertaEstadoUpdate(BaseModel):
    active: bool


class MonitoreoRequest(BaseModel):
    anio: int = Field(ge=2000, le=2100)
    organismo: str = Field(default="ersep")
    terminos: List[str] = Field(default_factory=lambda: list(DEFAULT_REGULATORY_TERMS))
    revalidar_pdfs: bool = False
    incluir_todas_ersep: bool = False
    mostrar_sin_cambios: bool = False

    @field_validator("organismo")
    @classmethod
    def validate_organismo(cls, value):
        value = str(value or "ersep").strip().lower()
        allowed = {"ersep", "capital_humano", "secretaria_general"}
        if value not in allowed:
            raise ValueError("Organismo de búsqueda no válido.")
        return value

    @field_validator("terminos", mode="before")
    @classmethod
    def normalize_terms(cls, value):
        if value is None:
            return list(DEFAULT_REGULATORY_TERMS)
        if isinstance(value, str):
            value = value.split(",")
        result: list[str] = []
        seen: set[str] = set()
        for item in value:
            text = str(item or "").strip()
            key = text.casefold()
            if len(text) < 2 or key in seen:
                continue
            seen.add(key)
            result.append(text)
        return result


class HistorialFilters(BaseModel):
    anio: Optional[int] = None
    prestadora: Optional[str] = None
    estado: Optional[str] = None
    alerta: Optional[str] = None
    texto: Optional[str] = None
    solo_novedades: bool = False
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=25, ge=1, le=200)
