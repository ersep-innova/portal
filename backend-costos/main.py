import json
import os

import gspread
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from google.oauth2.service_account import Credentials


app = FastAPI(title="API Costos y Tarifas ERSeP")

# Permite que el portal de GitHub Pages consulte esta API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)


SHEET_ID = os.getenv("COSTOS_GOOGLE_SHEET_ID")
SERVICE_ACCOUNT_JSON = os.getenv("COSTOS_GOOGLE_SERVICE_ACCOUNT_JSON")


def conectar_google_sheets():
    if not SHEET_ID:
        raise RuntimeError(
            "Falta la variable COSTOS_GOOGLE_SHEET_ID"
        )

    if not SERVICE_ACCOUNT_JSON:
        raise RuntimeError(
            "Falta la variable COSTOS_GOOGLE_SERVICE_ACCOUNT_JSON"
        )

    credenciales = json.loads(SERVICE_ACCOUNT_JSON)

    scopes = [
        "https://www.googleapis.com/auth/spreadsheets.readonly",
        "https://www.googleapis.com/auth/drive.readonly",
    ]

    credentials = Credentials.from_service_account_info(
        credenciales,
        scopes=scopes,
    )

    return gspread.authorize(credentials)


@app.get("/")
def inicio():
    return {
        "ok": True,
        "servicio": "API Costos y Tarifas ERSeP",
    }


@app.get("/api/hojas")
def listar_hojas():
    """
    Devuelve los nombres de todas las pestañas del Google Sheets.
    Nos sirve primero para comprobar que Render puede acceder
    correctamente a la planilla.
    """
    try:
        cliente = conectar_google_sheets()
        archivo = cliente.open_by_key(SHEET_ID)

        return {
            "ok": True,
            "hojas": [hoja.title for hoja in archivo.worksheets()],
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/hoja/{nombre_hoja}")
def leer_hoja(nombre_hoja: str):
    """
    Devuelve una pestaña completa del Google Sheets.
    La primera fila se utiliza como encabezado.
    """
    try:
        cliente = conectar_google_sheets()
        archivo = cliente.open_by_key(SHEET_ID)
        hoja = archivo.worksheet(nombre_hoja)

        datos = hoja.get_all_records(
            default_blank="",
            numericise_ignore=["all"],
        )

        return {
            "ok": True,
            "hoja": nombre_hoja,
            "cantidad": len(datos),
            "datos": datos,
        }

    except gspread.WorksheetNotFound:
        raise HTTPException(
            status_code=404,
            detail=f"No existe la hoja '{nombre_hoja}'",
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
