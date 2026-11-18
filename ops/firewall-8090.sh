#!/usr/bin/env bash
# Abre 8090/tcp SOLO para la red interna (rich rule permanente). Idempotente.
# Ejecutar: sudo bash ops/firewall-8090.sh [RANGO]   (por defecto 192.168.1.0/24)
set -euo pipefail
RANGO="${1:-192.168.1.0/24}"
ZONA="$(firewall-cmd --get-default-zone)"
REGLA="rule family=\"ipv4\" source address=\"${RANGO}\" port port=\"8090\" protocol=\"tcp\" accept"

[ "$(id -u)" -eq 0 ] || { echo "Ejecuta con sudo"; exit 1; }

# Si 8090 estuviera abierto a TODO el mundo (regla de puerto simple), se quita.
if firewall-cmd --permanent --zone="$ZONA" --query-port=8090/tcp >/dev/null 2>&1; then
  echo "Quitando apertura global de 8090/tcp (no restringida por rango)"
  firewall-cmd --permanent --zone="$ZONA" --remove-port=8090/tcp
fi

if firewall-cmd --permanent --zone="$ZONA" --query-rich-rule="$REGLA" >/dev/null 2>&1; then
  echo "La regla ya existe en la zona ${ZONA}: ${REGLA}"
else
  firewall-cmd --permanent --zone="$ZONA" --add-rich-rule="$REGLA"
  echo "Regla agregada en la zona ${ZONA}"
fi
firewall-cmd --reload
echo "== Reglas activas (zona ${ZONA}) =="
firewall-cmd --zone="$ZONA" --list-rich-rules
firewall-cmd --zone="$ZONA" --list-ports
