# RADAR

Publicador automático de noticias y recursos educativos para foros de Discord. Cloudflare Workers y D1, sin modelos de IA.

Servicio: https://radar.imtom100506.workers.dev

## Programación y límites

- Noticias: hasta **12 por día**, compartidas entre Diario Financiero, DW en español y BioBioChile. Solo artículos con fecha de las últimas 48 horas, ordenados por antigüedad. No evalúa importancia editorial. BBC no recibe consultas nuevas; conserva su historial.
- Biblioteca: hasta **8 publicaciones por día**, compartidas entre 15 fuentes. Es un máximo: no se rellena con recursos dudosos.
- Cron `7,27,38,47 * * * *`: Biblioteca a :07, :27 y :47; Noticias a :38. Biblioteca alterna las 15 fuentes, una vuelta cada cinco horas. Noticias alterna tres fuentes, una vuelta cada tres horas.
- Cupos por día de `America/Santiago`, con cambios de horario automáticos. Cuentan entregas enviadas, reservadas e inciertas. Máximo una publicación por ejecución.
- Las consultas continúan al alcanzar el cupo. Se descubren enlaces y se verifican hasta dos candidatos por turno; una consulta no equivale a revisar todo el catálogo.
- Los materiales educativos permanentes pueden ser anteriores: se comprueba disponibilidad actual y vigencia de convocatorias, sin inventar fechas de publicación. Los artículos de freeCodeCamp conservan una antigüedad máxima de 30 días.

## Fuentes

Noticias: [Diario Financiero](https://www.df.cl/noticias/site/list/port/rss.xml), [DW](https://rss.dw.com/rdf/rss-sp-all) y [BioBioChile](https://www.biobiochile.cl/static/feed-rss). BioBioChile se limita a Nacional, Internacional, Economía y Ciencia y Tecnología.

Biblioteca: freeCodeCamp en español, Kaggle Learn, MIT OpenCourseWare, NASA Learning Resources, Cisco Networking Academy, Microsoft Learn, OpenCENIA, UC, UDD, UAbierta/Universidad de Chile, UDP, UTFSM, USACH, Universidad de los Andes y UNAB.

Los adaptadores consultan catálogos públicos, RSS/Atom, sitemaps y APIs. [Cobertura y criterios por fuente](docs/library-sources.md). Añadir una institución no habilita automáticamente todos sus cursos: se valida cada candidato.

## Selección y publicación

Se buscan recursos de programación, tecnología, ciencias, datos, IA e investigación abierta. Se aceptan cursos, módulos, materiales docentes, guías, videos y datos abiertos. El contenido debe ser gratuito y público; la certificación opcional de pago se distingue del contenido. No se prometen certificados gratuitos.

Si no se verifica acceso, vigencia o costo, se omite el recurso. Los errores se registran y no detienen futuras consultas a otras fuentes. Los pendientes se vuelven a verificar antes del envío. No se publica un curso cerrado para llenar cupos.

Cada mensaje muestra fuente, enlace y los datos disponibles de tipo, tema, idioma, duración, nivel y costo. Las reglas internas no se incluyen en el mensaje. Títulos limitados a 100 caracteres y menciones desactivadas.

La primera consulta RSS registra el contenido existente sin publicarlo. Los nuevos catálogos educativos sí pueden aportar materiales existentes verificados. D1 evita URLs repetidas, bloquea ejecuciones simultáneas y reserva el cupo antes del envío. Una entrega incierta no se reintenta automáticamente.

## Configuración

Node 24. Instalar con `npm ci`; comprobar con `npm test`.

1. Autorizar Wrangler y configurar el binding D1 `DB` en `wrangler.jsonc`.
2. Aplicar `migrations/0001.sql` y `migrations/0002_library.sql`. Son aditivas y conservan el historial.
3. Guardar `DISCORD_BOT_TOKEN` con `wrangler secret put`, nunca en archivos publicados.
4. Configurar los foros en `NEWS_CHANNEL_ID` y `LIBRARY_CHANNEL_ID`. El bot necesita leer, enviar y crear hilos; no requiere Administrador.
5. Para etiquetas obligatorias: `NEWS_CHANNEL_ID_TAGS` o `LIBRARY_CHANNEL_ID_TAGS`, IDs separados por comas.
6. `NEWS_DAILY_LIMIT=12`, `LIBRARY_DAILY_LIMIT=8`. `ENABLED=false` detiene consultas y publicaciones. `INITIALIZE_ONLY=true` consulta sin publicar.
7. Desplegar con `npm run deploy` y revisar Observability.

`DIAGNOSTIC_UNTIL` limita el plazo de diagnósticos e impide publicar; al vencer detiene también las consultas. `DIAGNOSTIC_LIBRARY_ONLY=true` permite recorrer adaptadores con un cron temporal por minuto. Ambos están deshabilitados en la configuración normal.

El endpoint público solo identifica el servicio; no ejecuta publicaciones ni expone credenciales. La presencia de RADAR en Discord funciona por separado junto a TARS en Render y depende de la disponibilidad de ese proceso.

## Mantenimiento

RSS y rotación: `src/feeds.js`. Catálogos: `src/library-sources.js`. Descubrimiento y comprobación: `src/library.js`. Filtros internos: `src/library-policy.js`.

`library_checks` guarda la última consulta por fuente; `library_candidates`, los pendientes, su comprobación y descarte. Consultar ambas tablas para distinguir falta de recursos compatibles de un fallo de acceso. Revisar Discord antes de resolver registros `uncertain` o `reserved`.

Las páginas y APIs externas pueden cambiar. Hay límites de tamaño, tiempo, destinos y consultas. Cloudflare usa HTMLRewriter en streaming; los diagnósticos Node usan parse5. El plan gratuito tiene límites de CPU: revisar errores y consumo si una fuente deja de funcionar.

Validación: 36 pruebas automatizadas de rotación, cupos, duplicados, entregas inciertas, novedades de catálogo, consulta con cupo lleno, fechas y acceso. Los 14 adaptadores nuevos se comprobaron contra fuentes públicas y en el runtime local de Cloudflare el 8 de noviembre de 2026.
