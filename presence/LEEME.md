# Presencia de RADAR

Este módulo mantiene la conexión Gateway que Discord necesita para mostrar el bot conectado. Las publicaciones y el historial permanecen en Cloudflare Workers y D1.

Instalado y activado junto a TARS en Render, con conexión a Discord verificada en los registros. Necesita un proceso Node.js que permanezca encendido. Si ese proceso se detiene o Render suspende el servicio, el bot deja de aparecer conectado; las publicaciones de Cloudflare no dependen de esa conexión.

## Junto a TARS

TARS ya usa discord.js v14, por lo que no hace falta instalar otra biblioteca en ese proyecto.

1. Copiar `radarPresence.cjs` a la carpeta `src` de TARS.
2. Guardar el token de RADAR como secreto `RADAR_DISCORD_TOKEN` en el alojamiento de TARS. Es el token de RADAR, no el de TARS.
3. Añadir al inicio de TARS:

```js
require('./radarPresence.cjs').startRadarPresence();
```

El módulo crea un segundo cliente independiente, con estado en línea y actividad en español. No escucha mensajes, no responde comandos y no modifica el cliente de TARS. Si falta el secreto, se mantiene desactivado.

Para mostrar al bot en un grupo separado de la lista lateral, un administrador puede configurar un rol visible por separado en Discord; esto no reemplaza la conexión permanente.
