/* ============================================================================
   LUX VISION · Núcleo del visor de activos urbanos
   ----------------------------------------------------------------------------
   Todo lo municipal vive en `config.js`. Este archivo no debería necesitar
   cambios para replicar el visor en otra ciudad.

   Índice de secciones:

     01 · Configuración y constantes
     02 · Estado global
     03 · Helpers
     04 · Mapa (inicialización, tema, mapas base)
     05 · Carga de datos GeoJSON
     06 · Construcción de capas (fuentes + simbología)
     07 · Interacción con el mapa (ficha, Street View, selección)
     08 · Popup de solicitudes
     09 · Branding y fecha de actualización
     10 · Botones de capas del encabezado
     11 · KPIs
     12 · Filtros (distrito / tecnología de luminarias)
     13 · Panel de estadísticas
     14 · Leyenda y utilidades de UI
     15 · Exportación PDF
     16 · Arranque
   ============================================================================ */


/* ══════════════════════════════════════════════════════════════════════
   01 · CONFIGURACIÓN Y CONSTANTES
   ══════════════════════════════════════════════════════════════════════ */

const APP_CONFIG = window.LUX_CONFIG;
if (!APP_CONFIG) {
    throw new Error('[LUX] Falta config.js o window.LUX_CONFIG no está definido.');
}

const FUENTES_DATA = APP_CONFIG.fuentes;
const CONFIG_CAPAS = APP_CONFIG.capas;

/** URL de GeoServer (reservada: hoy los datos entran como GeoJSON estático). */
const geoServerBase = APP_CONFIG.geoserver.base; // eslint-disable-line no-unused-vars

/** GeoJSON vacío de referencia: estado inicial de cada capa hasta que carga su dato. */
const geojsonVacio = { type: 'FeatureCollection', features: [] };

/** Mapas base disponibles en el selector del encabezado. */
const ESTILOS_MAPA = {
    dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    light: {
        version: 8,
        sources: {
            'osm-tiles': {
                type: 'raster',
                tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                tileSize: 256,
                attribution: '© OpenStreetMap contributors'
            }
        },
        layers: [{ id: 'osm-layer', type: 'raster', source: 'osm-tiles', minzoom: 0, maxzoom: 19 }]
    },
    satellite: {
        version: 8,
        sources: {
            'satellite-tiles': {
                type: 'raster',
                tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
                tileSize: 256,
                attribution: 'Tiles © Esri'
            }
        },
        layers: [{ id: 'satellite-layer', type: 'raster', source: 'satellite-tiles', minzoom: 0, maxzoom: 24 }]
    }
};

/** IDs de las capas con ficha técnica (todas las de config). */
const capasInteractivas = () => Object.values(CONFIG_CAPAS).map(c => c.id);


/* ══════════════════════════════════════════════════════════════════════
   02 · ESTADO GLOBAL
   ══════════════════════════════════════════════════════════════════════ */

let estiloActual = (localStorage.getItem('theme-mode') || 'dark') === 'dark' ? 'dark' : 'light';
let modoCalorArbolado = false;
let filtroCategoriaLuminarias = null;

/** Datos completos por capa (se cargan una sola vez al inicio). */
let capasData = {
    luminarias: geojsonVacio,
    arbolado: geojsonVacio,
    vialidades: geojsonVacio,
    reclamos: geojsonVacio,
    cordon: geojsonVacio,
    banquina_vereda: geojsonVacio,
    cuneta: geojsonVacio
};

/** Polígonos de distritos (solo para el filtro; no se dibujan). */
let distritosData = geojsonVacio;

/** Visibilidad inicial de cada capa en el mapa. */
const visibilidadCapas = {
    luminarias: true, arbolado: true, vialidades: true,
    reclamos: true, cordon: true, banquina_vereda: true, cuneta: true
};

/**
 * Datos que se están visualizando AHORA.
 * Cambia con el filtro de distrito: los KPI y el panel de estadísticas
 * leen siempre de acá (no de `capasData`, que siempre tiene el total).
 */
window.datosActualesParaKPI = capasData;


/* ══════════════════════════════════════════════════════════════════════
   03 · HELPERS
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Devuelve el primer atributo presente entre las variantes indicadas.
 * Tolera diferencias de case y nombres alternativos en los datos.
 */
function getCampo(props, camposAlt, def = null) {
    if (!props || !Array.isArray(camposAlt)) return def;
    for (const c of camposAlt) {
        if (props[c] !== undefined && props[c] !== null && props[c] !== '') return props[c];
    }
    return def;
}

/** Versión en mayúsculas y sin espacios laterales de `getCampo`. */
function getCampoUpper(props, campos, def = '') {
    return String(getCampo(props, campos, def)).trim().toUpperCase();
}

/** Versión numérica de `getCampo` (NaN-safe). */
function getCampoNumero(props, campos, def = 0) {
    const val = getCampo(props, campos, null);
    if (val === null) return def;
    const num = parseFloat(val);
    return isNaN(num) ? def : num;
}

/** Busca la entrada de config correspondiente a un layerId del mapa. */
function getConfigPorCapaId(layerId) {
    for (const key of Object.keys(CONFIG_CAPAS)) {
        if (CONFIG_CAPAS[key].id === layerId) return { key, config: CONFIG_CAPAS[key] };
    }
    return null;
}

/** Datos vigentes (filtrados por distrito, si hay filtro activo). */
function datosActuales() {
    return window.datosActualesParaKPI || capasData;
}

/** Escribe texto en un elemento por ID, si existe. */
function setTexto(id, valor) {
    const el = document.getElementById(id);
    if (el) el.innerText = valor;
}


/* ══════════════════════════════════════════════════════════════════════
   04 · MAPA
   ══════════════════════════════════════════════════════════════════════ */

const map = new maplibregl.Map({
    container: 'map',
    style: ESTILOS_MAPA[estiloActual],
    center: APP_CONFIG.municipio.mapaInicial.center,
    zoom: APP_CONFIG.municipio.mapaInicial.zoom,
    preserveDrawingBuffer: true // requerido para capturar el mapa en el PDF
});

const styleSelect = document.getElementById('map-style-select');
const themeToggleBtn = document.getElementById('theme-toggle');
let modoVisual = localStorage.getItem('theme-mode') || 'dark';

/** Cambia el mapa base y reconstruye las capas cuando el estilo está listo. */
function cambiarEstiloMapa(nuevoEstilo) {
    if (!ESTILOS_MAPA[nuevoEstilo]) return;
    estiloActual = nuevoEstilo;
    if (styleSelect.value !== nuevoEstilo) styleSelect.value = nuevoEstilo;
    map.setStyle(ESTILOS_MAPA[estiloActual]);
    map.once('idle', () => inyectarFuentesYCapas());
}

/** Aplica el tema claro/oscuro a la UI (clase .dark en <html>). */
function aplicarModoVisual(modo) {
    modoVisual = modo;
    const esOscuro = modo === 'dark';
    document.documentElement.classList.toggle('dark', esOscuro);
    document.documentElement.dataset.theme = esOscuro ? 'dark' : 'light';

    if (themeToggleBtn) {
        themeToggleBtn.setAttribute('aria-pressed', String(esOscuro));
        themeToggleBtn.title = esOscuro ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro';
    }
    localStorage.setItem('theme-mode', modo);
}
aplicarModoVisual(modoVisual);

// Selector de mapa base: claro/oscuro además conmutan el tema de la UI.
styleSelect.addEventListener('change', (e) => {
    const estilo = e.target.value;
    if (estilo === 'dark' || estilo === 'light') aplicarModoVisual(estilo);
    cambiarEstiloMapa(estilo);
});

// Botón sol/luna: alterna tema y, si corresponde, también el mapa base.
themeToggleBtn.addEventListener('click', () => {
    const nuevoModo = modoVisual === 'dark' ? 'light' : 'dark';
    aplicarModoVisual(nuevoModo);
    if (nuevoModo === 'dark') cambiarEstiloMapa('dark');
    if (nuevoModo === 'light' && estiloActual === 'dark') cambiarEstiloMapa('light');
});

/** Activa/desactiva el heatmap de arbolado (toggle del dropdown). */
function aplicarModoCalorArbolado(activo) {
    modoCalorArbolado = Boolean(activo);
    if (map.getLayer('arbolado-heatmap-layer')) {
        map.setLayoutProperty('arbolado-heatmap-layer', 'visibility', activo ? 'visible' : 'none');
    }
    if (map.getLayer('arbolado-layer')) {
        map.setPaintProperty('arbolado-layer', 'circle-opacity', activo ? 0.22 : 0.85);
    }
    const btn = document.getElementById('btn-heatmap-arbolado');
    if (btn) btn.classList.toggle('is-active', activo);
}


/* ══════════════════════════════════════════════════════════════════════
   05 · CARGA DE DATOS GEOJSON
   ══════════════════════════════════════════════════════════════════════ */

/** Valida que la respuesta sea un FeatureCollection bien formado. */
function normalizarGeoJSON(data, key) {
    if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
        console.error(`[LUX] GeoJSON inválido en la fuente "${key}"`, data);
        return geojsonVacio;
    }
    return data;
}

/** Descarga todas las fuentes en paralelo y arranca el visor. */
function cargarTodosLosGeoJSON() {
    const peticiones = Object.keys(FUENTES_DATA).map(key =>
        fetch(FUENTES_DATA[key], { cache: 'no-store' })
            .then(res => { if (!res.ok) throw new Error(`${res.status}`); return res.json(); })
            .then(json => ({ key, data: normalizarGeoJSON(json, key) }))
            .catch(error => {
                console.error(`[LUX] No se pudo cargar la fuente "${key}"`, error);
                return { key, data: geojsonVacio };
            })
    );

    Promise.all(peticiones).then(resultados => {
        resultados.forEach(res => {
            if (res.key === 'distritos') distritosData = res.data;
            else capasData[res.key] = res.data;
        });

        window.datosActualesParaKPI = capasData;
        inyectarFuentesYCapas();
        registrarInteraccionMapa();
        configurarBotonesPrenderApagar();
        calcularKPIs();
        inicializarFiltroDistritos();
        actualizarFechaDesdeCapas();
    });
}


/* ══════════════════════════════════════════════════════════════════════
   06 · CONSTRUCCIÓN DE CAPAS
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Crea las fuentes y capas del mapa (si aún no existen).
 * Se vuelve a ejecutar tras cada cambio de mapa base, porque MapLibre
 * destruye las capas al cambiar de estilo.
 */
function inyectarFuentesYCapas() {
    const vis = key => visibilidadCapas[key] ? 'visible' : 'none';

    // ── Cordón / Banquina-Vereda / Cuneta: líneas del lateral vial ──
    agregarCapaLinea('cordon', 'cordon-source', 'cordon-layer',
        { color: '#b8875d', ancho: 1.8, opacidad: 0.82 });
    agregarCapaLinea('banquina_vereda', 'banquina-vereda-source', 'banquina-vereda-layer',
        { color: '#9a8f72', ancho: 1.6, opacidad: 0.78 });
    agregarCapaLinea('cuneta', 'cuneta-source', 'cuneta-layer',
        { color: '#6f93a3', ancho: 1.5, opacidad: 0.78 });

    // ── Vialidades: color según superficie de la calzada ──
    if (!map.getSource('vialidades-source')) {
        map.addSource('vialidades-source', { type: 'geojson', data: capasData.vialidades });
        map.addLayer({
            id: 'vialidades-layer', type: 'line', source: 'vialidades-source',
            paint: {
                'line-width': 3.5,
                'line-color': ['match', ['upcase', ['coalesce', ['get', 'superficie'], ['get', 'SUPERFICIE'], 'SIN DATO']],
                    'PAVIMENTADA', '#587b9b',
                    'CONSOLIDADA', '#7e9b83',
                    'TIERRA', '#b29169',
                    '#9aa3a8']
            },
            layout: { visibility: vis('vialidades'), 'line-cap': 'round', 'line-join': 'round' }
        });
    }

    // ── Arbolado: puntos por estado + capa heatmap (solo activable) ──
    if (!map.getSource('arbolado-source')) {
        map.addSource('arbolado-source', { type: 'geojson', data: capasData.arbolado });
        map.addLayer({
            id: 'arbolado-heatmap-layer', type: 'heatmap', source: 'arbolado-source', maxzoom: 18,
            paint: {
                'heatmap-weight': 1,
                'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 10, 0.7, 17, 1.5],
                'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 10, 12, 17, 28],
                'heatmap-opacity': 0.72,
                'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
                    0, 'rgba(79,122,97,0)',
                    0.25, 'rgba(132,158,111,0.30)',
                    0.5, 'rgba(166,166,105,0.48)',
                    0.75, 'rgba(184,135,93,0.62)',
                    1, 'rgba(169,92,86,0.78)']
            },
            layout: { visibility: modoCalorArbolado ? 'visible' : 'none' }
        });
        map.addLayer({
            id: 'arbolado-layer', type: 'circle', source: 'arbolado-source',
            paint: {
                'circle-radius': 4, 'circle-opacity': 0.85, 'circle-stroke-width': 0.5,
                'circle-stroke-color': 'rgba(15, 23, 42, 0.4)',
                'circle-color': ['match', ['upcase', ['coalesce', ['get', 'ESTADO_S'], ['get', 'estado_s'], ['get', 'ESTADO'], 'OTROS']],
                    'BUENO', '#4f7a61',
                    'REGULAR', '#78926f',
                    'MALO', '#a5a36f',
                    '#8d9b8f']
            },
            layout: { visibility: vis('arbolado') }
        });
    }

    // ── Luminarias: color según tecnología (LED / sodio / otras) ──
    if (!map.getSource('luminarias-source')) {
        map.addSource('luminarias-source', { type: 'geojson', data: capasData.luminarias });
        map.addLayer({
            id: 'luminarias-layer', type: 'circle', source: 'luminarias-source',
            paint: {
                'circle-color': colorPorTecnologiaLuminaria(),
                'circle-radius': 4, 'circle-stroke-width': 0.8, 'circle-stroke-color': '#0f172a'
            },
            layout: { visibility: vis('luminarias') }
        });
    }

    // ── Solicitudes: halo suave + puntos suspensivos como símbolo ──
    if (!map.getSource('reclamos-source')) {
        map.addSource('reclamos-source', { type: 'geojson', data: capasData.reclamos });
        map.addLayer({
            id: 'reclamos-layer', type: 'circle', source: 'reclamos-source',
            paint: {
                'circle-color': '#b76565', 'circle-radius': 9,
                'circle-opacity': 0.20, 'circle-blur': 0.65,
                'circle-stroke-width': 1.2, 'circle-stroke-color': '#a95656', 'circle-stroke-opacity': 0.48
            },
            layout: { visibility: vis('reclamos') }
        });
        map.addLayer({
            id: 'reclamos-punteado-layer', type: 'symbol', source: 'reclamos-source',
            layout: {
                'text-field': '···', 'text-size': 11, 'text-allow-overlap': true,
                visibility: vis('reclamos')
            },
            paint: { 'text-color': '#9f5151', 'text-opacity': 0.78 }
        });
    }
}

/** Helper: fuente + capa lineal genérica con estilo simple. */
function agregarCapaLinea(dataKey, sourceId, layerId, estilo) {
    if (map.getSource(sourceId)) return;
    map.addSource(sourceId, { type: 'geojson', data: capasData[dataKey] });
    map.addLayer({
        id: layerId, type: 'line', source: sourceId,
        paint: {
            'line-color': estilo.color,
            'line-width': estilo.ancho,
            'line-opacity': estilo.opacidad
        },
        layout: {
            visibility: visibilidadCapas[dataKey] ? 'visible' : 'none',
            'line-cap': 'round', 'line-join': 'round'
        }
    });
}

/** Expresión de color: LED cian, sodio amarillo, resto salmón. */
function colorPorTecnologiaLuminaria() {
    const campos = CONFIG_CAPAS.luminarias.simbologia?.tecnologiaCampo
        || CONFIG_CAPAS.luminarias.kpis.tecnologia.campo;
    const valor = ['upcase', ['to-string', ['coalesce', ...campos.map(c => ['get', c]), '']]];
    return ['case',
        ['in', 'LED', valor], '#22eff6',
        ['any', ['in', 'SAP', valor], ['in', 'SODIO', valor]], '#e2f916',
        '#e6b290'];
}


/* ══════════════════════════════════════════════════════════════════════
   07 · INTERACCIÓN CON EL MAPA
   ══════════════════════════════════════════════════════════════════════ */

/** Registra UNA VEZ los handlers de clic y cursor (sobre el mapa, no por
 *  capa): así no se duplican cuando cambia el mapa base. */
let interaccionRegistrada = false;
function registrarInteraccionMapa() {
    if (interaccionRegistrada) return;
    interaccionRegistrada = true;

    map.on('click', (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: capasInteractivas() });
        if (!features || features.length === 0) {
            limpiarSeleccion();
            return;
        }
        const feature = features[0];

        // Las solicitudes además abren su popup con el detalle del reclamo.
        if (feature.layer.id === CONFIG_CAPAS.reclamos.id) {
            abrirPopupReclamo(feature);
        }
        mostrarFicha(feature);
    });

    // Cursor de puntero sobre cualquier elemento interactivo.
    map.on('mousemove', (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: capasInteractivas() });
        map.getCanvas().style.cursor = (features && features.length) ? 'pointer' : '';
    });
}

/** Completa la ficha técnica con los atributos del feature seleccionado. */
function mostrarFicha(feature) {
    const props = feature.properties || {};
    const configInfo = getConfigPorCapaId(feature.layer.id);
    if (!configInfo) return;
    const { config } = configInfo;

    setTexto('info-id', getCampo(props, config.idCampo, 'N/A'));
    setTexto('info-elemento', config.elementoFijo || getCampo(props, ['elemento', 'ELEMENTO'], '-'));

    (config.camposFicha || []).forEach(([idInfo, idLabel, camposAlt, textoLabel]) => {
        setCampoFicha(idInfo, idLabel, getCampo(props, camposAlt, '-'), textoLabel);
    });

    actualizarStreetView(feature);
}

/** Escribe un campo de la ficha y lo oculta si no tiene dato. */
function setCampoFicha(idInfo, idLabel, valor, textoLabel) {
    const elInfo = document.getElementById(idInfo);
    const elLabel = document.getElementById(idLabel);
    if (elInfo) elInfo.innerText = (valor && valor !== '') ? valor : '-';
    if (elLabel && textoLabel) elLabel.innerText = textoLabel;

    const sinDato = !valor || valor === '-' || valor === 'Sin Dato' || valor === 'N/A';
    if (elInfo) {
        elInfo.classList.toggle('hidden', sinDato);
        if (elLabel) elLabel.classList.toggle('hidden', sinDato);
    }
}

/** Punto representativo del feature (para Street View y el marcador). */
function coordsDelFeature(feature) {
    const geom = feature.geometry;
    if (!geom) return null;
    if (geom.type === 'Point') return geom.coordinates;
    if (geom.type === 'LineString' && geom.coordinates.length) {
        return geom.coordinates[Math.floor(geom.coordinates.length / 2)];
    }
    return null;
}

/** Carga Street View y el marcador pulsante en la posición del feature. */
function actualizarStreetView(feature) {
    const coords = coordsDelFeature(feature);
    if (!coords) return;

    const [lon, lat] = coords;
    const strLat = lat.toString();
    const strLon = lon.toString();

    window.activoSeleccionadoLat = strLat;
    window.activoSeleccionadoLon = strLon;
    destacarPuntoEnMapa(lon, lat);

    const iframe = document.getElementById('street-view-frame');
    const placeholder = document.getElementById('sv-placeholder');

    if (placeholder) placeholder.classList.add('hidden');
    if (iframe) {
        iframe.classList.remove('hidden');
        iframe.src = `https://maps.google.com/maps?q=${strLat},${strLon}&cbll=${strLat},${strLon}&layer=c&panoid=&cbp=12,0,0,0,0&source=embed&output=svembed`;
    }

    const btn = document.getElementById('btn-sv-external');
    if (btn) {
        btn.href = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${strLat},${strLon}`;
        btn.classList.remove('pointer-events-none', 'opacity-50');
    }
}

/** Marcador de selección: punto cian con halo y anillo. */
function destacarPuntoEnMapa(lng, lat) {
    const sourceId = 'source-seleccion-activo';
    const punto = {
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] } }]
    };

    if (map.getSource(sourceId)) {
        map.getSource(sourceId).setData(punto);
        return;
    }

    map.addSource(sourceId, { type: 'geojson', data: punto });
    map.addLayer({
        id: 'layer-seleccion-glow', type: 'circle', source: sourceId,
        paint: { 'circle-radius': 22, 'circle-color': '#22d3ee', 'circle-opacity': 0.15 }
    });
    map.addLayer({
        id: 'layer-seleccion-ring', type: 'circle', source: sourceId,
        paint: {
            'circle-radius': 16, 'circle-color': 'transparent',
            'circle-stroke-width': 2, 'circle-stroke-color': '#22d3ee', 'circle-stroke-opacity': 0.6
        }
    });
    map.addLayer({
        id: 'layer-seleccion-activo', type: 'circle', source: sourceId,
        paint: {
            'circle-radius': 8, 'circle-color': '#31fff5',
            'circle-stroke-width': 3, 'circle-stroke-color': '#22d3ee'
        }
    });
}

/** Quita el marcador de selección (clic en zona sin elementos). */
function limpiarSeleccion() {
    const sourceId = 'source-seleccion-activo';
    if (map.getSource(sourceId)) {
        map.getSource(sourceId).setData({ type: 'FeatureCollection', features: [] });
    }
}


/* ══════════════════════════════════════════════════════════════════════
   08 · POPUP DE SOLICITUDES
   ══════════════════════════════════════════════════════════════════════ */

/** Popup con el detalle del reclamo, con los campos definidos en config. */
function abrirPopupReclamo(feature) {
    const props = feature.properties || {};
    const coords = coordsDelFeature(feature) || [];
    const P = APP_CONFIG.popupReclamos;

    const descripcion  = getCampo(props, P.descripcion, 'Sin descripción');
    const tipo         = getCampo(props, P.tipo, 'No especificado');
    const usuario      = getCampo(props, P.usuario, 'No especificado');
    const area         = getCampo(props, P.area, 'Sin área');
    const fecha        = getCampo(props, P.fecha, 'Sin dato');
    const fechaSolucion = getCampo(props, P.fechaSolucion, 'Pendiente');

    const html = `
        <div style="font-family: var(--font-ui, sans-serif); padding: 12px; max-width: 300px; color: #0f172a;">
            <div style="display:flex; justify-content:space-between; border-bottom:1px solid #e2e8f0; padding-bottom:8px; margin-bottom:10px;">
                <span style="font-size:11px; font-weight:700; text-transform:uppercase; color:#dc2626; letter-spacing:0.05em;">Detalle del Reclamo</span>
                <span style="font-size:9.5px; font-weight:700; background:#fee2e2; color:#991b1b; padding:2px 6px; border-radius:4px;">${tipo}</span>
            </div>
            <p style="font-size:11.5px; margin:0 0 10px 0; background:#f8fafc; padding:8px; border-radius:6px; border:1px solid #f1f5f9;">${descripcion}</p>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">
                <div style="background:#f8fafc; padding:6px 8px; border-radius:6px;"><small style="font-size:8.5px; color:#64748b; text-transform:uppercase; letter-spacing:0.05em;">Área</small><br><b style="font-size:10.5px;">${area}</b></div>
                <div style="background:#f8fafc; padding:6px 8px; border-radius:6px;"><small style="font-size:8.5px; color:#64748b; text-transform:uppercase; letter-spacing:0.05em;">Usuario</small><br><b style="font-size:10.5px;">${usuario}</b></div>
                <div style="background:#f1f5f9; padding:6px 8px; border-radius:6px;"><small style="font-size:8.5px; color:#64748b; text-transform:uppercase; letter-spacing:0.05em;">Fecha</small><br><b style="font-size:10.5px;">${fecha}</b></div>
                <div style="background:#f1f5f9; padding:6px 8px; border-radius:6px;"><small style="font-size:8.5px; color:#64748b; text-transform:uppercase; letter-spacing:0.05em;">Solución</small><br><b style="font-size:10.5px; color:#059669;">${fechaSolucion}</b></div>
            </div>
        </div>
    `;

    new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: '310px' })
        .setLngLat(coords)
        .setHTML(html)
        .addTo(map);
}


/* ══════════════════════════════════════════════════════════════════════
   09 · BRANDING Y FECHA DE ACTUALIZACIÓN
   ══════════════════════════════════════════════════════════════════════ */

/** Título y logos desde config: un solo lugar para cambiar la identidad. */
function aplicarConfiguracionMunicipal() {
    const { municipio } = APP_CONFIG;
    document.title = `Lux Vision — ${municipio.tituloAplicacion}`;

    const h1 = document.querySelector('header h1');
    if (h1) {
        h1.innerHTML = `${municipio.tituloAplicacion} <span class="text-slate-500 mx-1.5">•</span> Municipio de ${municipio.nombre}`;
    }

    const enlaces = document.querySelectorAll('header a');
    const imagenes = document.querySelectorAll('header a img');
    if (enlaces[0]) enlaces[0].href = municipio.branding.logoLux.href;
    if (imagenes[0]) imagenes[0].src = municipio.branding.logoLux.src;
    if (enlaces[1]) enlaces[1].href = municipio.branding.logoMunicipio.href;
    if (imagenes[1]) imagenes[1].src = municipio.branding.logoMunicipio.src;
}

/** Fecha más reciente entre las luminarias (formato dd/mm/aaaa). */
function actualizarFechaDesdeCapas() {
    const camposFecha = APP_CONFIG.camposGlobales.fechaActualizacion;
    let fechaMax = null;

    (capasData.luminarias.features || []).forEach(f => {
        const val = getCampo(f.properties || {}, camposFecha, null);
        if (!val || val === 'null' || val === 'None') return;

        let fecha = null;
        const strVal = String(val).trim();

        // Soporta "dd/mm/aaaa", "dd-mm-aaaa" y formatos ISO.
        if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}/.test(strVal)) {
            const [d, m, y] = strVal.split(/[\/\-]/);
            fecha = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
        } else {
            fecha = new Date(strVal);
        }

        if (fecha && !isNaN(fecha.getTime()) && fecha.getFullYear() >= 2020) {
            if (!fechaMax || fecha > fechaMax) fechaMax = fecha;
        }
    });

    const el = document.getElementById('fecha-ultima-actualizacion');
    if (!el) return;
    el.innerText = fechaMax
        ? fechaMax.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
        : 'Sin dato';
}


/* ══════════════════════════════════════════════════════════════════════
   10 · BOTONES DE CAPAS DEL ENCABEZADO
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Cada KPI del encabezado apaga/enciende su grupo de capas.
 * El botón "TODAS" alterna el estado conjunto.
 */
function configurarBotonesPrenderApagar() {
    const definiciones = {
        luminarias:  { btn: 'btn-mod-luminarias', layers: ['luminarias-layer'] },
        arbolado:    { btn: 'btn-mod-arbolado',   layers: ['arbolado-layer'] },
        vialidades:  { btn: 'btn-mod-vialidades', layers: ['vialidades-layer'] },
        cordon:      { btn: 'btn-mod-cordon',     layers: ['cordon-layer', 'banquina-vereda-layer', 'cuneta-layer'], keys: ['cordon', 'banquina_vereda', 'cuneta'] },
        reclamos:    { btn: 'btn-mod-reclamos',   layers: ['reclamos-layer', 'reclamos-punteado-layer'] }
    };

    const setEstadoVisual = (btn, activo) => {
        if (!btn) return;
        btn.classList.toggle('layer-button-off', !activo);
        btn.classList.toggle('layer-button-on', activo);
        btn.setAttribute('aria-pressed', String(activo));
    };

    const aplicarVisibilidad = (key, activo) => {
        const def = definiciones[key];
        (def.keys || [key]).forEach(k => { visibilidadCapas[k] = activo; });
        def.layers.forEach(layerId => {
            if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', activo ? 'visible' : 'none');
        });
        setEstadoVisual(document.getElementById(def.btn), activo);
    };

    const estanTodosActivos = () => Object.keys(definiciones).every(key =>
        (definiciones[key].keys || [key]).every(k => visibilidadCapas[k]));

    Object.entries(definiciones).forEach(([key, def]) => {
        const btn = document.getElementById(def.btn);
        if (!btn || btn.dataset.ready === '1') return;
        btn.dataset.ready = '1';

        const keys = def.keys || [key];
        setEstadoVisual(btn, keys.some(k => visibilidadCapas[k]));
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            aplicarVisibilidad(key, !keys.some(k => visibilidadCapas[k]));
            actualizarBotonTodos();
        });
    });

    const btnTodos = document.getElementById('btn-mod-todos');
    const actualizarBotonTodos = () => {
        if (!btnTodos) return;
        btnTodos.classList.toggle('opacity-50', !estanTodosActivos());
        btnTodos.setAttribute('aria-pressed', String(estanTodosActivos()));
    };

    if (btnTodos && btnTodos.dataset.ready !== '1') {
        btnTodos.dataset.ready = '1';
        btnTodos.addEventListener('click', (e) => {
            e.preventDefault();
            const encender = !estanTodosActivos();
            Object.keys(definiciones).forEach(key => aplicarVisibilidad(key, encender));
            actualizarBotonTodos();
        });
    }
    actualizarBotonTodos();
}


/* ══════════════════════════════════════════════════════════════════════
   11 · KPIs
   ══════════════════════════════════════════════════════════════════════ */

/** Recalcula todos los indicadores del encabezado sobre los datos vigentes
 *  (filtrados por distrito si hay un filtro activo). */
function calcularKPIs() {
    const datos = datosActuales();

    // ── Luminarias: total + desglose por tecnología ──
    const luminarias = datos.luminarias?.features || [];
    const totalLum = luminarias.length;
    const camposTec = CONFIG_CAPAS.luminarias?.kpis?.tecnologia?.campo
        || ['sap', 'SAP', 'tipo', 'TIPO', 'tecnologia', 'TECNOLOGIA', 'tipologia', 'TIPOLOGIA'];

    let led = 0, sodio = 0, otrosLum = 0;
    luminarias.forEach(f => {
        const tipo = getCampoUpper(f.properties || {}, camposTec, '');
        if (tipo.includes('LED')) led++;
        else if (tipo.includes('SAP') || tipo.includes('SODIO')) sodio++;
        else otrosLum++;
    });
    setTexto('kpi-total', totalLum.toLocaleString());
    setTexto('kpi-led', `${led.toLocaleString()} (${pct(led, totalLum)})`);
    setTexto('kpi-sodio', `${sodio.toLocaleString()} (${pct(sodio, totalLum)})`);
    setTexto('kpi-lum-otros', `${otrosLum.toLocaleString()} (${pct(otrosLum, totalLum)})`);

    // ── Arbolado: total + desglose por estado ──
    const arbolado = datos.arbolado?.features || [];
    const campoEstado = CONFIG_CAPAS.arbolado?.kpis?.estado?.campo || ['estado_s', 'ESTADO_S', 'ESTADO'];
    const estados = { BUENO: 0, REGULAR: 0, MALO: 0, OTROS: 0 };
    arbolado.forEach(f => {
        const v = getCampoUpper(f.properties || {}, campoEstado, '');
        if (v === 'BUENO') estados.BUENO++;
        else if (v === 'REGULAR') estados.REGULAR++;
        else if (v === 'MALO') estados.MALO++;
        else estados.OTROS++;
    });
    setTexto('kpi-arb-total', arbolado.length.toLocaleString());
    const idsEstado = { BUENO: 'kpi-arb-bueno', REGULAR: 'kpi-arb-regular', MALO: 'kpi-arb-malo', OTROS: 'kpi-arb-otros' };
    Object.entries(idsEstado).forEach(([k, id]) => {
        setTexto(id, `${estados[k].toLocaleString()} (${pct(estados[k], arbolado.length)})`);
    });

    // ── Vialidades: kilómetros por tipo de superficie ──
    const viales = datos.vialidades?.features || [];
    const cfgVial = CONFIG_CAPAS.vialidades?.kpis?.superficie || {};
    const kmVial = { PAVIMENTADA: 0, CONSOLIDADA: 0, TIERRA: 0, 'SIN DATO': 0 };
    viales.forEach(f => {
        const props = f.properties || {};
        const sup = getCampoUpper(props, cfgVial.campo || ['superficie', 'SUPERFICIE'], 'SIN DATO');
        const km = getCampoNumero(props, cfgVial.campoKm || ['km', 'KM'], 0);
        if (sup.includes('PAVIMENTADA')) kmVial.PAVIMENTADA += km;
        else if (sup.includes('CONSOLIDADA')) kmVial.CONSOLIDADA += km;
        else if (sup.includes('TIERRA')) kmVial.TIERRA += km;
        else kmVial['SIN DATO'] += km;
    });
    const totalKm = Object.values(kmVial).reduce((a, b) => a + b, 0);
    setTexto('kpi-vial-total', `${totalKm.toFixed(1)} km`);
    setTexto('kpi-vial-pav', `${kmVial.PAVIMENTADA.toFixed(1)} km`);
    setTexto('kpi-vial-cons', `${kmVial.CONSOLIDADA.toFixed(1)} km`);
    setTexto('kpi-vial-tierra', `${kmVial.TIERRA.toFixed(1)} km`);
    setTexto('kpi-vial-sd', `${kmVial['SIN DATO'].toFixed(1)} km`);

    // ── Lateral vial: km con cordón / banquina-vereda / cuneta ──
    const kmCordon = sumarKmPresencia(datos, 'cordon');
    const kmBanq = sumarKmPresencia(datos, 'banquina_vereda');
    const kmCuneta = sumarKmPresencia(datos, 'cuneta');
    setTexto('kpi-cordon-total', `${(kmCordon + kmBanq + kmCuneta).toFixed(1)} km`);
    setTexto('kpi-cordon-con', `${kmCordon.toFixed(1)} km`);
    setTexto('kpi-banquina-con', `${kmBanq.toFixed(1)} km`);
    setTexto('kpi-cuneta-con', `${kmCuneta.toFixed(1)} km`);

    // ── Solicitudes: total + por tipo ──
    const reclamos = datos.reclamos?.features || [];
    const campoTipoRec = CONFIG_CAPAS.reclamos?.kpis?.tipo?.campo || ['TIPO_S', 'tipo_s'];
    const rec = { INFRA: 0, MANT: 0, OBRA: 0, LED: 0, REP: 0 };
    reclamos.forEach(f => {
        const v = getCampoUpper(f.properties || {}, campoTipoRec, '');
        if (v === 'INFRAESTRUCTURA') rec.INFRA++;
        else if (v === 'MANTENIMIENTO OPERATIVO') rec.MANT++;
        else if (v === 'OBRA / EXTENSION DE RED' || v === 'OBRA / EXTENSIÓN DE RED') rec.OBRA++;
        else if (v === 'RECONVERSION LED' || v === 'RECONVERSIÓN LED') rec.LED++;
        else if (v === 'REPARACION / REPOSICION' || v === 'REPARACIÓN / REPOSICIÓN') rec.REP++;
    });
    setTexto('kpi-rec-total', reclamos.length.toLocaleString());
    setTexto('kpi-rec-infra', rec.INFRA.toLocaleString());
    setTexto('kpi-rec-mant', rec.MANT.toLocaleString());
    setTexto('kpi-rec-obra', rec.OBRA.toLocaleString());
    setTexto('kpi-rec-led', rec.LED.toLocaleString());
    setTexto('kpi-rec-rep', rec.REP.toLocaleString());
}

/** Porcentaje con un decimal y formato "xx.x%". */
function pct(parte, total) {
    return total ? ((parte / total) * 100).toFixed(1) + '%' : '0%';
}

/** Suma de kilómetros donde el campo de presencia coincide con el valor
 *  esperado (p. ej. CORDON === 'SI'), según la config de la capa. */
function sumarKmPresencia(datos, capaKey) {
    const cfg = CONFIG_CAPAS[capaKey]?.kpis?.presencia;
    if (!cfg) return 0;
    return (datos[capaKey]?.features || []).reduce((acc, f) => {
        const props = f.properties || {};
        const presente = getCampoUpper(props, cfg.campo, '') === String(cfg.valorEsperado || 'SI').toUpperCase();
        return acc + (presente ? getCampoNumero(props, cfg.campoKm, 0) : 0);
    }, 0);
}


/* ══════════════════════════════════════════════════════════════════════
   12 · FILTROS
   ══════════════════════════════════════════════════════════════════════ */

/* ── Geometría: punto en polígono (ray casting) ── */

function puntoEnPoligono(pt, poligono) {
    const [x, y] = pt;
    const rings = poligono.type === 'Polygon' ? [poligono.coordinates[0]]
        : poligono.type === 'MultiPolygon' ? poligono.coordinates.map(r => r[0])
        : [];

    let inside = false;
    for (const ring of rings) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const [xi, yi] = ring[i];
            const [xj, yj] = ring[j];
            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }
    }
    return inside;
}

/** Un punto representativo del feature para testear contra el polígono. */
function coordsRepresentativas(feature) {
    const g = feature.geometry;
    if (!g) return null;
    if (g.type === 'Point') return g.coordinates;
    if (g.type === 'LineString') return g.coordinates[Math.floor(g.coordinates.length / 2)];
    if (g.type === 'Polygon') return g.coordinates[0][0];
    if (g.type === 'MultiPolygon') return g.coordinates[0][0][0];
    return null;
}

/** Recorta todas las capas al polígono del distrito y recalcula KPIs. */
function aplicarFiltroGeometrico(polyGeom) {
    const filtradas = {};
    Object.keys(capasData).forEach(key => {
        const feats = (capasData[key].features || []).filter(f => {
            const pt = coordsRepresentativas(f);
            return pt ? puntoEnPoligono(pt, polyGeom) : false;
        });
        filtradas[key] = { type: 'FeatureCollection', features: feats };
        const sourceId = `${key}-source`;
        if (map.getSource(sourceId)) map.getSource(sourceId).setData(filtradas[key]);
    });
    window.datosActualesParaKPI = filtradas;
    filtroCategoriaLuminarias = null;
    calcularKPIs();
}

/** "Todos" restaura los datos completos. */
function quitarFiltroDistrito() {
    Object.keys(capasData).forEach(key => {
        const sourceId = `${key}-source`;
        if (map.getSource(sourceId)) map.getSource(sourceId).setData(capasData[key]);
    });
    window.datosActualesParaKPI = capasData;
    filtroCategoriaLuminarias = null;
    calcularKPIs();
}

/** Filtra todas las capas por el distrito elegido. */
function aplicarFiltroDistrito(nombreDistrito) {
    if (nombreDistrito === 'Todos') {
        quitarFiltroDistrito();
        return;
    }
    const campoNombre = APP_CONFIG.camposGlobales.distritoNombre;
    const distritoFeat = (distritosData.features || []).find(f =>
        getCampo(f.properties || {}, campoNombre, '') === nombreDistrito
    );
    if (distritoFeat) aplicarFiltroGeometrico(distritoFeat.geometry);
}

/** Llena el <select> de distritos con los nombres encontrados en los datos. */
function inicializarFiltroDistritos() {
    const select = document.getElementById('filtro-distrito');
    if (!select) return;

    const campoNombre = APP_CONFIG.camposGlobales.distritoNombre;
    const nombres = [...new Set(
        (distritosData.features || [])
            .map(f => getCampo(f.properties || {}, campoNombre, ''))
            .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b));

    nombres.forEach(nombre => {
        const op = document.createElement('option');
        op.value = nombre;
        op.innerText = nombre;
        select.appendChild(op);
    });

    select.addEventListener('change', (e) => aplicarFiltroDistrito(e.target.value));
}

/* ── Filtro por tecnología de luminarias (dropdown del KPI) ── */

function clasificarTecnologiaLuminaria(feature) {
    const cfg = CONFIG_CAPAS.luminarias.kpis.tecnologia;
    const valor = getCampoUpper(feature?.properties || {}, cfg.campo, '');
    if (valor.includes('LED')) return 'LED';
    if (valor.includes('SAP') || valor.includes('SODIO')) return 'SODIO';
    return 'OTROS';
}

/** Filtra la capa de luminarias por categoría; volver a clicar la misma
 *  categoría quita el filtro. */
function aplicarFiltroCategoriaLuminarias(categoria) {
    filtroCategoriaLuminarias = (filtroCategoriaLuminarias === categoria) ? null : categoria;

    const base = datosActuales().luminarias || capasData.luminarias;
    const features = filtroCategoriaLuminarias
        ? (base.features || []).filter(f => clasificarTecnologiaLuminaria(f) === filtroCategoriaLuminarias)
        : (base.features || []);

    const source = map.getSource(CONFIG_CAPAS.luminarias.source);
    if (source) source.setData({ type: 'FeatureCollection', features });

    document.querySelectorAll('[data-lum-category]').forEach(el => {
        el.classList.toggle('is-active', el.dataset.lumCategory === filtroCategoriaLuminarias);
    });

    // KPIs de luminarias coherentes con lo que se ve.
    const counts = { LED: 0, SODIO: 0, OTROS: 0 };
    features.forEach(f => counts[clasificarTecnologiaLuminaria(f)]++);
    setTexto('kpi-total', features.length.toLocaleString());
    setTexto('kpi-led', `${counts.LED.toLocaleString()} (${pct(counts.LED, features.length)})`);
    setTexto('kpi-sodio', `${counts.SODIO.toLocaleString()} (${pct(counts.SODIO, features.length)})`);
    setTexto('kpi-lum-otros', `${counts.OTROS.toLocaleString()} (${pct(counts.OTROS, features.length)})`);
}


/* ══════════════════════════════════════════════════════════════════════
   13 · PANEL DE ESTADÍSTICAS
   ══════════════════════════════════════════════════════════════════════ */

const statsChartInstances = {};

function destruirChartsStats() {
    Object.keys(statsChartInstances).forEach(k => {
        statsChartInstances[k]?.destroy();
        delete statsChartInstances[k];
    });
}

/** Renderiza las secciones del panel sobre los datos vigentes. */
function renderizarEstadisticas() {
    const cont = document.getElementById('stats-content');
    if (!cont) return;
    destruirChartsStats();

    const datos = datosActuales();

    const filaLimpia = (label, val, color) => `
        <div class="flex justify-between items-center py-1.5 border-b border-slate-100 dark:border-slate-800 last:border-0">
            <span class="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 truncate">
                <span class="w-2 h-2 rounded-full" style="background-color:${color};"></span>${label}
            </span>
            <span class="font-semibold text-xs text-slate-900 dark:text-slate-100">${val}</span>
        </div>`;

    const seccion = (titulo, contenido) => `
        <div class="bg-white dark:bg-slate-900 rounded-xl p-4 border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-3">
            <h3 class="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 border-b border-slate-100 dark:border-slate-800 pb-2">${titulo}</h3>
            ${contenido}
        </div>`;

    const fmtKW = v => v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kW';

    // ── Resumen general con barras relativas ──
    const totalLum = datos.luminarias?.features?.length || 0;
    const totalArb = datos.arbolado?.features?.length || 0;
    const totalRec = datos.reclamos?.features?.length || 0;

    let totalKmViales = 0;
    (datos.vialidades?.features || []).forEach(f =>
        totalKmViales += getCampoNumero(f.properties, ['km', 'KM'], 0));

    const kmCordon = sumarKmPresencia(datos, 'cordon');
    const kmBanq = sumarKmPresencia(datos, 'banquina_vereda');
    const kmCuneta = sumarKmPresencia(datos, 'cuneta');
    const totalKmLateral = kmCordon + kmBanq + kmCuneta;

    const maxVal = Math.max(totalLum, totalArb, totalRec, totalKmViales) || 1;
    const barra = (label, valor, colorClass) => {
        const pctBar = (valor / maxVal) * 100;
        return `
            <div class="space-y-1.5 mb-2.5">
                <div class="flex justify-between items-center text-xs">
                    <span class="font-medium text-slate-700 dark:text-slate-300">${label}</span>
                    <span class="font-semibold text-slate-900 dark:text-slate-100">${typeof valor === 'number' ? valor.toLocaleString() : valor}</span>
                </div>
                <div class="w-full bg-slate-100 dark:bg-slate-800 rounded-md h-2 overflow-hidden">
                    <div class="${colorClass} h-2 rounded-md transition-all duration-500" style="width:${pctBar}%"></div>
                </div>
            </div>`;
    };

    // ── Luminarias: torta LED vs otras + potencia instalada ──
    const lumCfg = CONFIG_CAPAS.luminarias;
    let led = 0, otras = 0, wattsLed = 0, wattsOtras = 0, wattsTotal = 0;
    (datos.luminarias?.features || []).forEach(f => {
        const props = f.properties || {};
        const val = getCampoUpper(props, lumCfg.kpis.tecnologia.campo, '');
        const pot = getCampoNumero(props, ['potencia', 'POTENCIA'], 0);
        if (val.includes('LED')) { led++; wattsLed += pot; } else { otras++; wattsOtras += pot; }
        wattsTotal += pot;
    });

    // ── Arbolado: top especies ──
    const especies = {};
    (datos.arbolado?.features || []).forEach(f => {
        const esp = getCampo(f.properties, CONFIG_CAPAS.arbolado.kpis.especie.campo, 'Sin especie');
        const k = (esp === '' || esp === 'NULL') ? 'Sin especie' : esp;
        especies[k] = (especies[k] || 0) + 1;
    });
    const topEspecies = Object.entries(especies).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const maxEsp = topEspecies[0]?.[1] || 1;

    cont.className = 'space-y-4 p-2 overflow-y-auto max-h-[calc(100vh-80px)] pr-2';
    cont.innerHTML = `
        ${seccion('Resumen General', `
            ${barra('Luminarias', totalLum, 'bg-blue-600')}
            ${barra('Árboles', totalArb, 'bg-emerald-600')}
            ${barra('Solicitudes', totalRec, 'bg-rose-500')}
            ${barra('Lateral Vial (km)', parseFloat(totalKmLateral.toFixed(1)), 'bg-slate-500')}
            ${barra('Vialidades (km)', parseFloat(totalKmViales.toFixed(1)), 'bg-indigo-600')}
        `)}
        ${seccion('Luminarias por Tecnología', `<div class="relative h-48 w-full"><canvas id="chart-tecnologia"></canvas></div>`)}
        ${seccion('Potencia Instalada', `
            <div class="space-y-2">
                ${filaLimpia('Total', fmtKW(wattsTotal / 1000), '#4f46e5')}
                ${filaLimpia('LED', fmtKW(wattsLed / 1000), '#3b82f6')}
                ${filaLimpia('Otras', fmtKW(wattsOtras / 1000), '#94a3b8')}
            </div>`)}
        ${seccion('Arbolado por Especie', `
            <div class="space-y-3 pt-1">
                ${topEspecies.map(([nombre, cant]) => {
                    const p = (cant / maxEsp) * 100;
                    return `<div class="space-y-1">
                        <div class="flex justify-between text-xs">
                            <span class="truncate max-w-[150px] text-slate-700 dark:text-slate-300">${nombre}</span>
                            <span class="font-semibold">${cant.toLocaleString()}</span>
                        </div>
                        <div class="w-full bg-slate-100 dark:bg-slate-800 rounded h-1.5 overflow-hidden">
                            <div class="bg-emerald-600 h-1.5 rounded" style="width:${p}%"></div>
                        </div>
                    </div>`;
                }).join('')}
            </div>`)}
    `;

    // Torta LED vs otras (Chart.js) con colores de leyenda según tema.
    const isDark = document.documentElement.classList.contains('dark');
    const labelColor = isDark ? '#e2e8f0' : '#334155';
    const ctx = document.getElementById('chart-tecnologia')?.getContext('2d');
    if (ctx) {
        statsChartInstances.tecnologia = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: [`LED (${led})`, `Otras (${otras})`],
                datasets: [{ data: [led, otras], backgroundColor: ['#3b82f6', '#94a3b8'], borderWidth: 0 }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom', labels: { color: labelColor, font: { size: 11 }, boxWidth: 0, padding: 12 } } }
            }
        });
    }
}

function inicializarPanelEstadisticas() {
    const btn = document.getElementById('btn-stats');
    const btnClose = document.getElementById('btn-close-stats');
    const panel = document.getElementById('stats-panel');
    if (!btn || !btnClose || !panel) return;

    btn.addEventListener('click', () => {
        renderizarEstadisticas();
        panel.classList.remove('translate-x-full');
    });
    btnClose.addEventListener('click', () => {
        panel.classList.add('translate-x-full');
        destruirChartsStats();
    });
}


/* ══════════════════════════════════════════════════════════════════════
   14 · LEYENDA Y UTILIDADES DE UI
   ══════════════════════════════════════════════════════════════════════ */

/** Acordeón "Referencias" sobre el mapa. */
function inicializarLeyenda() {
    const btn = document.getElementById('legend-toggle');
    const panel = document.getElementById('legend-panel');
    const chevron = document.getElementById('legend-chevron');
    if (!btn || !panel || btn.dataset.ready === '1') return;
    btn.dataset.ready = '1';
    panel.classList.add('hidden');

    btn.addEventListener('click', (e) => {
        e.preventDefault();
        const abrir = panel.classList.contains('hidden');
        panel.classList.toggle('hidden', !abrir);
        if (chevron) chevron.textContent = abrir ? '▴' : '▾';
    });
}

/** Acordeón "Ver más campos" de la ficha técnica. */
function inicializarAcordeonFicha() {
    const btn = document.getElementById('btn-ver-mas-campos');
    const panel = document.getElementById('campos-secundarios');
    const chevron = document.getElementById('chevron-ver-mas');
    const label = document.getElementById('label-ver-mas');
    if (!btn || !panel || btn.dataset.ready === '1') return;
    btn.dataset.ready = '1';

    btn.addEventListener('click', (e) => {
        e.preventDefault();
        const abrir = panel.classList.contains('hidden');
        panel.classList.toggle('hidden', !abrir);
        if (chevron) chevron.style.transform = abrir ? 'rotate(180deg)' : 'rotate(0deg)';
        if (label) label.textContent = abrir ? 'Ver menos campos' : 'Ver más campos';
    });
}

/** Botones de tecnología del dropdown de luminarias. */
function inicializarFiltroCategoriasLuminarias() {
    document.querySelectorAll('[data-lum-category]').forEach(el => {
        if (el.dataset.ready === '1') return;
        el.dataset.ready = '1';
        el.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            aplicarFiltroCategoriaLuminarias(el.dataset.lumCategory);
        });
    });
}

/** Toggle del mapa de calor de arbolado. */
function inicializarHeatmapArbolado() {
    const btn = document.getElementById('btn-heatmap-arbolado');
    if (!btn || btn.dataset.ready === '1') return;
    btn.dataset.ready = '1';
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        aplicarModoCalorArbolado(!modoCalorArbolado);
    });
}


/* ══════════════════════════════════════════════════════════════════════
   15 · EXPORTACIÓN PDF
   ══════════════════════════════════════════════════════════════════════ */

/** Genera un PDF A4 con el mapa capturado, KPIs y (si hay) la ficha del
 *  elemento seleccionado. Se imprime el mismo HTML visible en pantalla. */
function inicializarExportacionPDF() {
    const btnPdf = document.getElementById('btn-export-pdf');
    if (!btnPdf || btnPdf.dataset.ready === '1') return;
    btnPdf.dataset.ready = '1';

    btnPdf.addEventListener('click', () => {
        const { municipio } = APP_CONFIG;

        // Captura del mapa (por eso preserveDrawingBuffer: true).
        let mapaBase64 = null;
        let aspectHeight = 220;
        try {
            mapaBase64 = map.getCanvas().toDataURL('image/png');
            const mapaDom = document.getElementById('map');
            if (mapaDom && mapaDom.clientWidth > 0) {
                aspectHeight = Math.round(714 * (mapaDom.clientHeight / mapaDom.clientWidth));
            }
        } catch (err) {
            console.error('[LUX] No se pudo capturar el mapa', err);
        }

        const kpi = id => document.getElementById(id)?.innerText || '0';
        const infoId = document.getElementById('info-id')?.innerText || '-';
        const haySeleccion = infoId && infoId !== '-' && infoId.trim() !== '';

        let tablaFichaHtml = '';
        let enlaceGeoHtml = '';

        if (haySeleccion) {
            const g = id => document.getElementById(id)?.innerText || '-';
            const mapUrl = `https://www.google.com/maps/search/?api=1&query=${window.activoSeleccionadoLat},${window.activoSeleccionadoLon}`;
            enlaceGeoHtml = `
                <div style="background:#f0f9ff; border:1px solid #bae6fd; border-radius:8px; padding:12px 15px; margin-bottom:20px; font-size:11px;">
                    <div style="font-weight:bold; color:#0369a1; margin-bottom:4px;">Geolocalización:</div>
                    <a href="${mapUrl}" target="_blank" style="color:#0284c7; word-break:break-all; font-weight:bold;">${mapUrl}</a>
                </div>`;

            tablaFichaHtml = `
                <div style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; overflow:hidden; margin-bottom:25px;">
                    <div style="background:#f8fafc; padding:10px 15px; border-bottom:1px solid #e2e8f0;">
                        <span style="font-size:11px; font-weight:bold; color:#475569; text-transform:uppercase; letter-spacing:0.05em;">Parámetros del Componente</span>
                        <span style="float:right; font-size:10px; background:#e0f2fe; color:#0369a1; padding:2px 8px; border-radius:4px;">ID: ${infoId}</span>
                    </div>
                    <table style="width:100%; border-collapse:collapse; font-size:11px;">
                        <tbody>
                            <tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:8px 12px; color:#64748b; width:40%;">Tipo de Elemento</td><td style="padding:8px 12px; font-weight:bold;">${g('info-elemento')}</td></tr>
                            <tr style="border-bottom:1px solid #f1f5f9; background:#fafaf9;"><td style="padding:8px 12px; color:#64748b;">Tecnología</td><td style="padding:8px 12px; font-weight:bold;">${g('info-tipo')}</td></tr>
                            <tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:8px 12px; color:#64748b;">Potencia</td><td style="padding:8px 12px;">${g('info-potencia')}</td></tr>
                            <tr style="border-bottom:1px solid #f1f5f9; background:#fafaf9;"><td style="padding:8px 12px; color:#64748b;">Marca / Modelo</td><td style="padding:8px 12px;">${g('info-marca')} / ${g('info-modelo')}</td></tr>
                            <tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:8px 12px; color:#64748b;">Calle</td><td style="padding:8px 12px; font-weight:bold;">${g('info-calle')}</td></tr>
                            <tr style="border-bottom:1px solid #f1f5f9; background:#fafaf9;"><td style="padding:8px 12px; color:#64748b;">Soporte</td><td style="padding:8px 12px;">${g('info-soporte')}</td></tr>
                            <tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:8px 12px; color:#64748b;">Función</td><td style="padding:8px 12px;">${g('info-funcion')} (${g('info-brazo')})</td></tr>
                            <tr><td style="padding:8px 12px; color:#64748b; background:#fafaf9;">Fecha Act</td><td style="padding:8px 12px; background:#fafaf9;">${g('info-fecha-act')}</td></tr>
                        </tbody>
                    </table>
                </div>`;
        } else {
            tablaFichaHtml = `<div style="padding:20px; background:#f8fafc; border:1px dashed #cbd5e1; border-radius:8px; text-align:center; color:#64748b; font-size:11.5px; margin-bottom:25px;">Reporte general. Haga clic sobre un activo para incluir su ficha técnica.</div>`;
        }

        // Contenedor off-screen que se convierte a canvas → PDF.
        const printContainer = document.createElement('div');
        Object.assign(printContainer.style, {
            position: 'absolute', left: '-9999px', top: '-9999px',
            width: '794px', backgroundColor: '#fff', padding: '40px',
            fontFamily: 'Archivo, Inter, sans-serif', color: '#1e293b'
        });

        printContainer.innerHTML = `
            <div style="background:#040d3d; color:#fff; margin:-40px -40px 25px -40px; padding:25px 40px; border-bottom:4px solid #5a9cf2;">
                <h1 style="font-size:20px; margin:0 0 5px 0; text-transform:uppercase; letter-spacing:0.03em;">Reporte de Activos Urbanos</h1>
                <p style="font-size:11px; margin:0; color:#94a3b8;">Municipio de ${municipio.nombre} &bull; ${municipio.tituloAplicacion}</p>
            </div>

            <h2 style="font-size:13px; color:#040d3d; border-left:4px solid #5a9cf2; padding-left:8px; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:12px;">Total de Activos Urbanos</h2>
            <div style="display:flex; gap:10px; margin-bottom:25px;">
                <div style="flex:1; background:#ecfeff; border:1px solid #06b6d4; border-radius:6px; padding:10px; text-align:center;"><div style="font-size:9px; color:#0891b2; font-weight:bold; letter-spacing:0.05em; text-transform:uppercase;">Luminarias</div><div style="font-size:16px; font-weight:bold; color:#0891b2;">${kpi('kpi-total')}</div></div>
                <div style="flex:1; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:10px; text-align:center;"><div style="font-size:9px; color:#64748b; font-weight:bold; letter-spacing:0.05em; text-transform:uppercase;">Arbolado</div><div style="font-size:16px; font-weight:bold;">${kpi('kpi-arb-total')}</div></div>
                <div style="flex:1; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:10px; text-align:center;"><div style="font-size:9px; color:#64748b; font-weight:bold; letter-spacing:0.05em; text-transform:uppercase;">Vialidades</div><div style="font-size:16px; font-weight:bold;">${kpi('kpi-vial-total')}</div></div>
                <div style="flex:1; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:10px; text-align:center;"><div style="font-size:9px; color:#64748b; font-weight:bold; letter-spacing:0.05em; text-transform:uppercase;">Lateral Vial</div><div style="font-size:16px; font-weight:bold;">${kpi('kpi-cordon-total')}</div></div>
                <div style="flex:1; background:#fff5f5; border:1px solid #feb2b2; border-radius:6px; padding:10px; text-align:center;"><div style="font-size:9px; color:#c53030; font-weight:bold; letter-spacing:0.05em; text-transform:uppercase;">Solicitudes</div><div style="font-size:16px; font-weight:bold; color:#c53030;">${kpi('kpi-rec-total')}</div></div>
            </div>

            <h2 style="font-size:13px; color:#040d3d; border-left:4px solid #5a9cf2; padding-left:8px; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:12px;">Vista del Mapa</h2>
            <div style="width:100%; height:${aspectHeight}px; border:1px solid #cbd5e1; border-radius:8px; overflow:hidden; margin-bottom:25px; background:#f1f5f9;">
                ${mapaBase64
                    ? `<img src="${mapaBase64}" style="width:100%; height:100%; object-fit:contain; background:#0f172a;" />`
                    : `<div style="padding-top:80px; text-align:center; color:#64748b;">Mapa no disponible</div>`}
            </div>

            <div style="display:flex; justify-content:space-between; margin-bottom:12px;">
                <h2 style="font-size:13px; color:#040d3d; border-left:4px solid #5a9cf2; padding-left:8px; text-transform:uppercase; letter-spacing:0.05em; margin:0;">Ficha del Elemento</h2>
                ${enlaceGeoHtml}
            </div>

            ${tablaFichaHtml}

            <div style="padding:12px; background:#f8fafc; border-radius:6px; border-left:4px solid #cbd5e1; font-size:10px; color:#64748b;">
                <strong>Nota:</strong> Generado el ${new Date().toLocaleString('es-AR')}.
            </div>
        `;

        document.body.appendChild(printContainer);

        html2canvas(printContainer, { scale: 2, useCORS: true, logging: false })
            .then(canvas => {
                const imgData = canvas.toDataURL('image/jpeg', 0.95);
                const { jsPDF } = window.jspdf;
                const pdf = new jsPDF('p', 'mm', 'a4');
                const pdfWidth = pdf.internal.pageSize.getWidth();
                const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
                pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);
                pdf.save(`Reporte_Activos_${haySeleccion ? infoId.replace(/\s+/g, '_') : 'General'}.pdf`);
                document.body.removeChild(printContainer);
            })
            .catch(err => {
                console.error('[LUX] Error al generar el PDF', err);
                document.body.removeChild(printContainer);
            });
    });
}


/* ══════════════════════════════════════════════════════════════════════
   16 · ARRANQUE
   ══════════════════════════════════════════════════════════════════════ */

aplicarConfiguracionMunicipal();

// Cuando el mapa está listo, se cargan los datos y se construye el visor.
map.on('load', () => cargarTodosLosGeoJSON());

// Cableado de toda la UI una vez disponible el DOM.
document.addEventListener('DOMContentLoaded', () => {
    inicializarFiltroCategoriasLuminarias();
    inicializarHeatmapArbolado();
    inicializarPanelEstadisticas();
    inicializarLeyenda();
    inicializarAcordeonFicha();
    inicializarExportacionPDF();
});

// Handle de depuración / integración: permite inspeccionar el estado
// desde la consola (LUX.map, LUX.datos, LUX.aplicarFiltroDistrito...).
window.LUX = {
    map,
    get datos() { return datosActuales(); },
    get capas() { return capasData; },
    aplicarFiltroDistrito,
    calcularKPIs
};
