# RADAR

Publicador de RSS para los foros de Discord Noticias y Biblioteca. Sin IA.

## Estado

Desplegado y activo en Cloudflare Workers y D1. Ambos foros de The Goats recibieron su publicación de prueba. La inicialización registró 34 noticias y 10 recursos existentes sin publicarlos. Las dos ejecuciones reales terminaron correctamente. `ENABLED=false` desactiva todas las consultas y publicaciones programadas.

Servicio: https://radar.imtom100506.workers.dev

La presencia de RADAR está desplegada junto a TARS en Render, con un cliente independiente y el secreto `RADAR_DISCORD_TOKEN`. Se verificó la conexión de ambos bots en los registros del despliegue `af30e45`. La presencia depende de que Render mantenga el proceso funcionando; el plan gratuito y los pings no garantizan disponibilidad continua. Las publicaciones funcionan independientemente desde Cloudflare.

## Fuentes y funcionamiento

- Cloudflare Workers Free y D1; no requiere una conexión permanente a Discord.
- Cron a los minutos 7 y 38 de cada hora: Biblioteca a :07 y Noticias a :38. Las tres fuentes de noticias se turnan por hora; cada una se revisa cada tres horas. Biblioteca conserva su revisión cada hora.
- Noticias: [Diario Financiero](https://www.df.cl/noticias/site/list/port/rss.xml), [DW en español](https://rss.dw.com/rdf/rss-sp-all) y [BioBioChile](https://www.biobiochile.cl/static/feed-rss). BBC Mundo queda excluida de las consultas y publicaciones nuevas; se conserva su historial.
- BioBioChile: solo secciones Nacional, Internacional, Economía y Ciencia y Tecnología. Este filtro temático aproxima relevancia, sin evaluar importancia editorial.
- freeCodeCamp español continúa como fuente de recursos educativos.
- Primera consulta: registra el contenido existente sin publicarlo.
- Máximo de una publicación por ejecución, hasta 12 noticias y 6 recursos de Biblioteca por día, con cupos independientes. El día se calcula en America/Santiago (con cambios de horario automáticos).
- Publica título y enlace con atribución, sin copiar artículos completos ni prometer certificados gratuitos.
- Selección por fuente y antigüedad (hasta dos días para noticias), más el filtro temático de BioBioChile; no verifica hechos. Lee RSS 2.0, RSS 1.0/RDF y Atom.
- No repite enlaces conocidos y desactiva menciones.
- Ante resultados de entrega ambiguos, conserva el registro para revisión; no reintenta automáticamente arriesgando duplicados.

Canales configurados: Noticias `1568787404339290202`, Biblioteca `1501665090792063067`. Los límites se configuran con `NEWS_DAILY_LIMIT=12` y `LIBRARY_DAILY_LIMIT=6`; las tres fuentes de noticias comparten el cupo de Noticias. Las publicaciones enviadas, reservadas o de entrega incierta cuentan para su respectivo cupo diario, incluido el historial de BBC. Solo se publican novedades posteriores a la inicialización: una revisión sin novedades no crea mensajes. Las noticias deben tener como máximo 48 horas y se priorizan las más recientes; no se evalúa su importancia ni se utiliza IA.

Validación: ejecutar `npm test` para comprobar el publicador, incluyendo RDF, entidades XML, filtro temático y rotación completa de fuentes. Los diagnósticos iniciales de Cloudflare terminaron con resultado `ok` (27 y 15 ms de CPU); estos valores no garantizan que toda ejecución futura encaje en los límites gratuitos. Revisar errores y consumo en Observability si dejan de aparecer novedades.

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
