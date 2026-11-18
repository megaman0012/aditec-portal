#!/usr/bin/env python3
"""Capturas del portal con Playwright (herramienta de desarrollo).

Uso (la clave se pasa por variable de entorno, nunca por argumento):
  docker run --rm --network host -e PORTAL_URL=http://127.0.0.1:8091 -e PORTAL_USUARIO=dev \
    -e PORTAL_CLAVE=desarrollo-123 -e SALIDA=/out -v "$PWD/scripts":/s:ro,Z -v /ruta/salida:/out:Z \
    mcr.microsoft.com/playwright/python:v1.48.0-noble python3 /s/capturas.py

Además de las capturas, informa errores de consola (p. ej. violaciones de CSP) y fallos de red.
"""
import os
import sys
from playwright.sync_api import sync_playwright

URL = os.environ.get("PORTAL_URL", "http://127.0.0.1:8091")
USUARIO = os.environ["PORTAL_USUARIO"]
CLAVE = os.environ["PORTAL_CLAVE"]
SALIDA = os.environ.get("SALIDA", "/out")
PREFIJO = os.environ.get("PREFIJO", "dev")
QUERY = os.environ.get("QUERY", "")  # p. ej. "desde=2026-10-01&hasta=2026-10-31&comparar=1"

problemas = []


def vigilar(page):
    page.on("console", lambda m: problemas.append(f"consola {m.type}: {m.text}") if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: problemas.append(f"error JS: {e}"))
    page.on("requestfailed", lambda r: problemas.append(f"red: {r.url} {r.failure}"))


def esperar_tablero(page):
    page.wait_for_selector("body:not(.cargando)", state="attached", timeout=20000)  # sin eval: respeta la CSP
    page.wait_for_timeout(900)  # animaciones de Chart.js


with sync_playwright() as p:
    nav = p.chromium.launch()
    # ---------- escritorio
    ctx = nav.new_context(viewport={"width": 1440, "height": 900}, locale="es-EC", timezone_id="America/Guayaquil")
    page = ctx.new_page()
    vigilar(page)
    page.goto(f"{URL}/" + (f"?{QUERY}" if QUERY else ""))
    page.wait_for_url("**/login.html**")
    page.screenshot(path=f"{SALIDA}/{PREFIJO}-0-login.png")
    page.fill("#usuario", USUARIO)
    page.fill("#password", CLAVE)
    page.click("#btn-ingresar")
    page.wait_for_url(lambda u: "/login.html" not in u)
    esperar_tablero(page)
    page.screenshot(path=f"{SALIDA}/{PREFIJO}-1-escritorio.png", full_page=True)
    print("URL tras login:", page.url)

    # comparar con año anterior
    if not page.is_checked("#f-comparar"):
        page.check("#f-comparar")
        page.wait_for_timeout(900)
    page.screenshot(path=f"{SALIDA}/{PREFIJO}-2-comparativo.png", full_page=True)

    # clic en una barra -> resalta asesor en la tabla
    lienzos = page.locator(".grafico:not(.centro) canvas")
    if lienzos.count():
        lienzo = lienzos.nth(2)
        lienzo.scroll_into_view_if_needed()
        # posición real de la 2.ª barra según Chart.js
        pos = lienzo.evaluate("c => { const b = Chart.getChart(c).getDatasetMeta(0).data[1]; return {x: b.x, y: (b.y + b.base) / 2}; }")
        caja = lienzo.bounding_box()
        page.mouse.click(caja["x"] + pos["x"], caja["y"] + pos["y"])
        page.wait_for_timeout(900)
        print("celdas resaltadas:", page.locator("#tabla .resaltado").count())
        page.locator("#tabla-tarjeta").screenshot(path=f"{SALIDA}/{PREFIJO}-3-tabla-resaltada.png")

    # selector de asesores abierto
    page.evaluate("window.scrollTo(0,0)")
    page.click(".multi-boton")
    page.fill(".multi-buscar", "a")
    page.wait_for_timeout(300)
    page.screenshot(path=f"{SALIDA}/{PREFIJO}-4-filtros.png", clip={"x": 0, "y": 0, "width": 1440, "height": 560})
    page.keyboard.press("Escape")
    ctx.close()

    # ---------- tablet (vertical)
    ctx = nav.new_context(viewport={"width": 834, "height": 1112}, locale="es-EC", timezone_id="America/Guayaquil", device_scale_factor=1)
    page = ctx.new_page()
    vigilar(page)
    page.goto(f"{URL}/login.html")
    page.fill("#usuario", USUARIO)
    page.fill("#password", CLAVE)
    page.click("#btn-ingresar")
    page.wait_for_url(lambda u: "/login.html" not in u)
    if QUERY:
        page.goto(f"{URL}/?{QUERY}")
    esperar_tablero(page)
    page.screenshot(path=f"{SALIDA}/{PREFIJO}-5-tablet.png", full_page=True)
    ctx.close()
    nav.close()

print("PROBLEMAS:" if problemas else "Sin errores de consola ni de red.")
for x in problemas:
    print(" -", x)
sys.exit(1 if any("error" in x for x in problemas) else 0)
