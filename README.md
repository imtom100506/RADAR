# RADAR

Publicador de RSS para los foros de Discord Noticias y Biblioteca. Sin IA.

## Estado

Desplegado y activo en Cloudflare Workers y D1. Ambos foros de The Goats recibieron su publicación de prueba. La inicialización registró 34 noticias y 10 recursos existentes sin publicarlos. Las dos ejecuciones reales terminaron correctamente. `ENABLED=false` desactiva todas las consultas y publicaciones programadas.

Servicio: https://radar.imtom100506.workers.dev

La presencia de RADAR está desplegada junto a TARS en Render, con un cliente independiente y el secreto `RADAR_DISCORD_TOKEN`. Se verificó la conexión de ambos bots en los registros del despliegue `af30e45`. La presencia depende de que Render mantenga el proceso funcionando; el plan gratuito y los pings no garantizan disponibilidad continua. Las publicaciones funcionan independientemente desde Cloudflare.

## Diseño inicial

- Cloudflare Workers Free y D1; no requiere una conexión permanente a Discord.
- Cron a los minutos 7 y 38 de cada hora: Biblioteca a :07 y Noticias a :38. Cada fuente se revisa una vez por hora.
- BBC Mundo para noticias; freeCodeCamp español para recursos educativos.
- Primera consulta: registra el contenido existente sin publicarlo.
- Máximo de una publicación por ejecución y seis publicaciones totales por día de Chile, zona America/Santiago (con cambios de horario automáticos).
- Publica título y enlace con atribución, sin copiar artículos completos ni prometer certificados gratuitos.
- Selección por fuente y antigüedad; no evalúa importancia editorial ni verifica hechos.
- No repite enlaces conocidos y desactiva menciones.
- Ante resultados de entrega ambiguos, conserva el registro para revisión; no reintenta automáticamente arriesgando duplicados.

Canales configurados: Noticias `1568787404339290202`, Biblioteca `1501665090792063067`. Límite de seis publicaciones diarias entre ambos canales. Solo se publican novedades posteriores a la inicialización: una revisión sin novedades no crea mensajes.

Validación: 15 pruebas del publicador y 133 pruebas de la integración en TARS. Los diagnósticos iniciales de Cloudflare terminaron con resultado `ok` (27 y 15 ms de CPU); estos valores no garantizan que toda ejecución futura encaje en los límites gratuitos. Revisar errores y consumo en Observability si dejan de aparecer novedades.

## Configuración

Instalar con `npm ci` y ejecutar pruebas con `npm test` (Node 24).

1. Autorizar Wrangler en la cuenta Cloudflare.
2. Crear D1 `radar-db` y añadir su identificador como binding `DB` en `wrangler.jsonc`.
3. Aplicar `migrations/0001.sql` en la base remota.
4. Crear la aplicación RADAR en Discord e instalarla en el servidor con permisos de ver canal, enviar mensajes y enviar mensajes en hilos según lo necesario. No necesita permiso Administrador ni intents privilegiados.
5. Guardar `DISCORD_BOT_TOKEN` mediante `wrangler secret put`; nunca en archivos publicados.
6. Configurar `NEWS_CHANNEL_ID` y `LIBRARY_CHANNEL_ID`; deben ser canales tipo foro.
7. Si un foro exige etiquetas, configurar `NEWS_CHANNEL_ID_TAGS` o `LIBRARY_CHANNEL_ID_TAGS` con identificadores separados por comas.
8. Desplegar en pausa, verificar permisos y publicar una prueba controlada; luego activar `ENABLED=true`.
9. Verificar registros y consumo de CPU en Cloudflare. El límite gratuito de CPU por ejecución exige medir el caso real.

El endpoint público solo identifica el servicio; no permite ejecutar publicaciones ni expone credenciales.

Editar `src/feeds.js` para cambiar fuentes. Añadir fuentes nuevas requiere revisar la rotación y el consumo. El historial se conserva en D1. Los casos `uncertain` o `reserved` necesitan revisar Discord antes de volver a intentar un envío.
