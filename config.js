/* ============================================================================
   LUX VISION · CONFIGURACIÓN MUNICIPAL
   ----------------------------------------------------------------------------
   ÚNICO archivo que hay que editar para replicar el visor en otro municipio.

   Pasos de replicación:
     1 · municipio    → nombre, título, centro/zoom inicial y logos.
     2 · fuentes      → rutas de los GeoJSON (una por capa + distritos).
     3 · camposGlobales → nombres de los atributos en TUS datos (mayúsc./min.).
     4 · capas        → por cada capa: qué se muestra en la ficha técnica
                        (camposFicha) y qué se calcula en los KPI (kpis).

   Convención: los nombres de atributo se declaran en TODAS sus variantes
   ("campo", "CAMPO") para que el visor tolere datos con distinto case.
   ============================================================================ */

window.LUX_CONFIG = {

  /* ── 1 · IDENTIDAD DEL MUNICIPIO ─────────────────────────────────────── */
  municipio: {
    nombre: 'Rivadavia',
    tituloAplicacion: 'Sistema de Monitoreo de Activos Urbanos',
    locale: 'es-AR',
    mapaInicial: { center: [-68.468, -33.191], zoom: 15 },
    branding: {
      logoLux:       { src: 'logo_lux_byn.png', href: 'link'  },
      logoMunicipio: { src: 'logo_riv_2.png',   href: 'links' }
    }
  },

  /* ── 2 · SERVIDOR DE MAPAS (reservado) ─────────────────────────────────
     Hoy los datos entran como GeoJSON estático (ver "fuentes"). La URL de
     GeoServer queda referenciada para una futura migración a WFS.        */
  geoserver: {
    base: 'http://localhost:8090/geoserver/visor_rivadavia/ows?service=WFS&version=1.0.0&request=GetFeature'
  },

  /* ── 3 · FUENTES DE DATOS (GeoJSON, uno por capa) ────────────────────── */
  fuentes: {
    luminarias:      './luminarias_riv_wgs84.geojson',
    arbolado:        './arboles_v2.geojson',
    vialidades:      './vialidad_ej_4.geojson',
    reclamos:        './reclamos_rv.geojson',
    cordon:          './cordon.geojson',
    banquina_vereda: './banquina_vereda.geojson',
    cuneta:          './cuneta.geojson',
    distritos:       './distritos_riv_ide.geojson'
  },

  /* ── 4 · ATRIBUTOS GLOBALES ──────────────────────────────────────────── */
  camposGlobales: {
    fechaActualizacion: ['fecha_act', 'FECHA_ACT', 'Fecha_Act'],
    distritoNombre:     ['nombre', 'NOMBRE', 'distrito', 'DISTRITO', 'name']
  },

  /* ── 5 · POPUP DE SOLICITUDES (campos que se muestran al hacer clic) ── */
  popupReclamos: {
    descripcion:  ['Descripción del reclamo', 'Descripción del Reclamo', 'Descripcion del reclamo', 'DESCRIPCION_DEL_RECLAMO', 'DESCRIPCIO', 'DESCRIPCION', 'descripcion'],
    tipo:         ['Tipo', 'TIPO', 'tipo', 'Tipo de reclamo', 'TIPO_RECLAMO'],
    usuario:      ['Usuario', 'USUARIO', 'usuario', 'Usuario ', 'User', 'Usuario_1'],
    area:         ['Área', 'Area', 'AREA', 'area', 'AREA_RESPONSABLE'],
    fecha:        ['FECHA', 'fecha', 'Fecha', 'FECHA_ING', 'fecha_ing'],
    fechaSolucion:['Fecha Solución', 'FECHA_SOLUCION', 'fecha_solucion']
  },

  /* ── 6 · DEFINICIÓN DE CAPAS ───────────────────────────────────────────
     id / source : nombres técnicos del mapa (no renombrar sin tocar app.js)
     camposFicha : [idValor, idEtiqueta, [posibles atributos], textoEtiqueta]
     kpis        : configuración de cada cálculo del encabezado
     idCampo     : atributo que identifica al elemento (ID de la ficha)    */
  capas: {

    luminarias: {
      id: 'luminarias-layer',
      source: 'luminarias-source',
      label: 'Luminarias',
      camposFicha: [
        ['info-tipo',       'label-tipo',       ['sap', 'SAP', 'tipo', 'TIPO', 'tecnologia', 'TECNOLOGIA', 'tipologia', 'TIPOLOGIA'], 'Tecnología'],
        ['info-potencia',   'label-potencia',   ['potencia', 'POTENCIA'], 'Potencia'],
        ['info-marca',      'label-marca',      ['marca', 'MARCA'], 'Marca'],
        ['info-modelo',     'label-modelo',     ['modelo', 'MODELO'], 'Modelo'],
        ['info-calle',      'label-calle',      ['calle', 'CALLE'], 'Calle'],
        ['info-soporte',    'label-soporte',    ['soporte', 'SOPORTE'], 'Soporte'],
        ['info-funcion',    'label-funcion',    ['funcion', 'FUNCION'], 'Función'],
        ['info-brazo',      'label-brazo',      ['brazo', 'BRAZO'], 'Brazo'],
        ['info-streetview', 'label-streetview', ['streetview', 'STREETVIEW'], 'StreetView'],
        ['info-fecha-act',  'label-fecha-act',  ['fecha_act', 'FECHA_ACT'], 'Fecha Act.']
      ],
      kpis: {
        tecnologia: {
          campo: ['sap', 'SAP', 'tipo', 'TIPO', 'tecnologia', 'TECNOLOGIA', 'tipologia', 'TIPOLOGIA'],
          grupos: {
            'LED':   (v) => v.includes('LED'),
            'SODIO': (v) => v.includes('SAP') || v.includes('SODIO'),
            'OTROS': (v) => true
          }
        },
        soporte: { campo: ['soporte', 'SOPORTE'], grupos: ['BRAZO', 'COLGANTE', 'HORMIGON', 'MADERA', 'METALICO', 'PARED', 'TORRE'] },
        funcion: { campo: ['funcion', 'FUNCION'], grupos: ['CALLE', 'ESP VERDE', 'ESPACIO PUBLICO', 'VEREDA'] },
        zona:    { campo: ['zona', 'ZONA'],       grupos: ['RURAL', 'URBANO', 'SIN DATO'] },
        elemento:{ campo: ['elemento', 'ELEMENTO'], grupos: ['COLGANTE', 'FALTANTE', 'FAROLA', 'PEPITA', 'PERITA', 'PROYECTOR', 'REFLECTOR', 'TULIPA', 'VEREDA', 'VIAL'] },
        potencia:{ campo: ['potencia', 'POTENCIA'] }
      },
      idCampo: ['id', 'ID'],
      simbologia: { tecnologiaCampo: ['sap', 'SAP', 'tipo', 'TIPO', 'tecnologia', 'TECNOLOGIA', 'tipologia', 'TIPOLOGIA'] }
    },

    arbolado: {
      id: 'arbolado-layer',
      source: 'arbolado-source',
      label: 'Árboles',
      camposFicha: [
        ['info-tipo',       'label-tipo',       ['especie', 'ESPECIE'], 'Especie'],
        ['info-potencia',   'label-potencia',   ['dimension', 'DIMENSION'], 'Dimensión'],
        ['info-marca',      'label-marca',      ['estado_s', 'ESTADO_S', 'ESTADO'], 'Estado Vegetativo'],
        ['info-modelo',     'label-modelo',     ['tronco', 'TRONCO'], 'Tronco'],
        ['info-calle',      'label-calle',      ['calle', 'CALLE'], 'Calle'],
        ['info-soporte',    'label-soporte',    ['base', 'BASE'], 'Base'],
        ['info-streetview', 'label-streetview', ['f_street_v', 'F_STREET_V'], 'F. Street View'],
        ['info-fecha-act',  'label-fecha-act',  ['fecha_act', 'FECHA_ACT'], 'Fecha Act.']
      ],
      kpis: {
        estado: {
          campo: ['estado_s', 'ESTADO_S', 'ESTADO'],
          grupos: {
            'BUENO':   (v) => v === 'BUENO',
            'REGULAR': (v) => v === 'REGULAR',
            'MALO':    (v) => v === 'MALO',
            'OTROS':   (v) => true
          }
        },
        especie: { campo: ['especie', 'ESPECIE'] }
      },
      idCampo: ['id', 'ID'],
      elementoFijo: 'Arbolado'
    },

    vialidades: {
      id: 'vialidades-layer',
      source: 'vialidades-source',
      label: 'Vialidades',
      camposFicha: [
        ['info-tipo',     'label-tipo',     ['nombre', 'NOMBRE'], 'Nombre'],
        ['info-potencia', 'label-potencia', ['ZONA', 'zona'], 'Zona'],
        ['info-marca',    'label-marca',    ['superficie', 'SUPERFICIE'], 'Mat. Calzada'],
        ['info-modelo',   'label-modelo',   ['km', 'KM'], 'KM'],
        ['info-calle',    'label-calle',    ['sentido', 'SENTIDO'], 'Sentido'],
        ['info-soporte',  'label-soporte',  ['jerarquia', 'JERARQUIA'], 'Jerarquía']
      ],
      kpis: {
        superficie: {
          campo: ['superficie', 'SUPERFICIE'],
          grupos: {
            'PAVIMENTADA': (v) => v.includes('PAVIMENTADA'),
            'CONSOLIDADA': (v) => v.includes('CONSOLIDADA'),
            'TIERRA':      (v) => v.includes('TIERRA'),
            'SIN DATO':    (v) => true
          },
          campoKm: ['km', 'KM']
        }
      },
      idCampo: ['osm_id', 'OSM_ID', 'id', 'ID'],
      elementoFijo: 'Vialidad'
    },

    cordon: {
      id: 'cordon-layer',
      source: 'cordon-source',
      label: 'Cordón',
      camposFicha: [
        ['info-tipo',     'label-tipo',     ['cordon', 'CORDON'], 'Cordón'],
        ['info-potencia', 'label-potencia', ['cord_estado', 'CORD_ESTADO'], 'Estado Cordón'],
        ['info-marca',    'label-marca',    ['km_cordon', 'KM_CORDON'], 'KM Cordón'],
        ['info-modelo',   'label-modelo',   ['lado', 'LADO'], 'Lado'],
        ['info-calle',    'label-calle',    ['fecha', 'FECHA'], 'Fecha']
      ],
      kpis: {
        presencia: { campo: ['cordon', 'CORDON'], campoKm: ['km_cordon', 'KM_CORDON'], valorEsperado: 'SI' }
      },
      idCampo: ['id', 'ID'],
      elementoFijo: 'Cordón'
    },

    banquina_vereda: {
      id: 'banquina-vereda-layer',
      source: 'banquina-vereda-source',
      label: 'Banquina / Vereda',
      camposFicha: [
        ['info-tipo',     'label-tipo',     ['banq_vrda', 'BANQ_VRDA'], 'Banq. / Vereda'],
        ['info-potencia', 'label-potencia', ['b_v_estado', 'B_V_ESTADO'], 'Estado B/V'],
        ['info-marca',    'label-marca',    ['km', 'KM'], 'KM'],
        ['info-modelo',   'label-modelo',   ['km_b_v', 'KM_B_V'], 'KM B/V'],
        ['info-calle',    'label-calle',    ['lado', 'LADO'], 'Lado'],
        ['info-soporte',  'label-soporte',  ['fecha', 'FECHA'], 'Fecha']
      ],
      kpis: {
        presencia: { campo: ['banq_vrda', 'BANQ_VRDA'], campoKm: ['km_b_v', 'KM_B_V'], valorEsperado: 'SI' }
      },
      idCampo: ['id', 'ID'],
      elementoFijo: 'Banquina / Vereda'
    },

    cuneta: {
      id: 'cuneta-layer',
      source: 'cuneta-source',
      label: 'Cuneta',
      camposFicha: [
        ['info-tipo',     'label-tipo',     ['cuneta', 'CUNETA'], 'Cuneta'],
        ['info-potencia', 'label-potencia', ['cun_mat', 'CUN_MAT'], 'Material'],
        ['info-marca',    'label-marca',    ['km_cuneta', 'KM_CUNETA'], 'KM Cuneta'],
        ['info-modelo',   'label-modelo',   ['lado', 'LADO'], 'Lado'],
        ['info-calle',    'label-calle',    ['fecha', 'FECHA'], 'Fecha']
      ],
      kpis: {
        presencia: { campo: ['cuneta', 'CUNETA'], campoKm: ['km_cuneta', 'KM_CUNETA'], valorEsperado: 'SI' }
      },
      idCampo: ['id', 'ID'],
      elementoFijo: 'Cuneta'
    },

    reclamos: {
      id: 'reclamos-layer',
      source: 'reclamos-source',
      label: 'Solicitudes',
      camposFicha: [
        ['info-tipo',     'label-tipo',     ['Tipo', 'TIPO', 'tipo'], 'Tipo'],
        ['info-potencia', 'label-potencia', ['Usuario', 'USUARIO', 'usuario', 'Usuario '], 'Usuario'],
        ['info-marca',    'label-marca',    ['Área', 'Area', 'AREA', 'area'], 'Área'],
        ['info-modelo',   'label-modelo',   ['Descripción del reclamo', 'Descripción del Reclamo', 'Descripcion del reclamo', 'DESCRIPCION_DEL_RECLAMO', 'DESCRIPCION', 'descripcion'], 'Descripción'],
        ['info-calle',    'label-calle',    ['Fecha', 'FECHA', 'fecha'], 'Fecha'],
        ['info-soporte',  'label-soporte',  ['Fecha Solución', 'FECHA_SOLUCION', 'fecha_solucion'], 'Fecha Solución']
      ],
      kpis: {
        tipo: {
          campo: ['TIPO_S', 'tipo_s'],
          grupos: {
            'Infraestructura':         (v) => v === 'Infraestructura',
            'Mantenimiento Operativo': (v) => v === 'Mantenimiento Operativo',
            'Obra / Extension de Red': (v) => v === 'Obra / Extension de Red',
            'Reconversion LED':        (v) => v === 'Reconversion LED',
            'Reparacion / Reposicion': (v) => v === 'Reparacion / Reposicion'
          }
        }
      },
      idCampo: ['id', 'ID'],
      elementoFijo: 'Reclamo'
    }
  }
};
