#!/usr/bin/env bash
# Fija la IP del servidor del Portal ADITEC (la misma que hoy entrega el DHCP).
# MBA3 autoriza por IP: si cambia, el portal deja de sincronizar.
# Ejecutar: sudo bash ops/ip-fija.sh
set -euo pipefail

CON="enp0s3"            # conexión de NetworkManager
IFACE="enp0s3"
IP="192.168.1.50/24"
GW="192.168.1.254"
DNS="192.168.1.1 8.8.8.8"
MBA3_HOST="192.168.1.203"; MBA3_PORT=8081

[ "$(id -u)" -eq 0 ] || { echo "Ejecuta con sudo"; exit 1; }

echo "== Respaldo de la configuración actual =="
BK="/root/nm-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BK"
cp -a /etc/NetworkManager/system-connections/. "$BK"/ 2>/dev/null || true
nmcli -g ipv4.method,ipv4.addresses,ipv4.gateway,ipv4.dns con show "$CON" > "$BK/ipv4-antes.txt"
echo "Respaldo en $BK"

rollback() {
  echo "!! Verificación fallida: volviendo a DHCP"
  nmcli con mod "$CON" ipv4.method auto ipv4.addresses "" ipv4.gateway "" ipv4.ignore-auto-dns no
  nmcli con up "$CON" || true
  ip -4 -br a show "$IFACE"
  exit 1
}

echo "== Aplicando IP fija $IP gw $GW dns $DNS =="
nmcli con mod "$CON" \
  ipv4.method manual ipv4.addresses "$IP" ipv4.gateway "$GW" \
  ipv4.dns "$DNS" ipv4.ignore-auto-dns yes connection.autoconnect yes
# reapply no baja la interfaz; si no se puede, se reactiva la conexión
nmcli dev reapply "$IFACE" 2>/dev/null || nmcli con up "$CON"
sleep 3

echo "== Verificación =="
ip -4 -br a show "$IFACE"
ip route | grep default
nmcli -g ipv4.method con show "$CON"
OK=0
ping -c 2 -W 2 "$GW" >/dev/null 2>&1 && { echo "gateway $GW: responde"; OK=1; }
timeout 3 bash -c "</dev/tcp/$MBA3_HOST/$MBA3_PORT" 2>/dev/null && { echo "MBA3 $MBA3_HOST:$MBA3_PORT: alcanzable"; OK=1; }
getent hosts download.docker.com >/dev/null && echo "DNS: resuelve"
[ "$OK" -eq 1 ] || rollback
echo "LISTO: IP fija aplicada. Respaldo en $BK"
