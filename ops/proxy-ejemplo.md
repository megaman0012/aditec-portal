# Portal ADITEC detrás del proxy inverso (dominio + HTTPS)

Preparado, **no activo**. Pasos cuando exista el proxy común en la red `aditec-net`:

1. En `docker-compose.yml`: quitar `ports:` y descomentar `expose`, `environment` (y `labels` si es Traefik).
2. Ajustar `TRUSTED_PROXY_IPS` a la IP/red del contenedor del proxy (`docker network inspect aditec-net`).
3. `docker compose up -d` y cerrar el 8090 en firewalld (ya no hace falta):
   `sudo firewall-cmd --permanent --zone=public --remove-rich-rule='rule family="ipv4" source address="192.168.1.0/24" port port="8090" protocol="tcp" accept' && sudo firewall-cmd --reload`

## Nginx (contenedor en aditec-net)
```nginx
server {
    listen 443 ssl http2;
    server_name portal.aditec.local;
    ssl_certificate     /etc/nginx/certs/portal.crt;
    ssl_certificate_key /etc/nginx/certs/portal.key;

    location / {
        proxy_pass http://aditec-portal:8090;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-For   $remote_addr;   # reemplaza (no encadena) la cabecera del cliente
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 60s;
    }
}
server { listen 80; server_name portal.aditec.local; return 301 https://$host$request_uri; }
```

## Caddy
```caddy
portal.aditec.local {
    tls internal
    reverse_proxy aditec-portal:8090
}
```

El portal ya envía CSP, X-Frame-Options, nosniff y Referrer-Policy; con HTTPS conviene añadir en el proxy
`Strict-Transport-Security: max-age=31536000`.
