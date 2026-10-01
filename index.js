require('dotenv').config()
const express = require('express')
const cors = require('cors')
const axios = require('axios')
const crypto = require('crypto')
const multer = require('multer')
const nodemailer = require('nodemailer')
const { exchangeCodeForToken, saveStore } = require('./tiendanube/api')
const { syncAllStores, startCron } = require('./tiendanube/cron')
const app = express()
const PORT = process.env.PORT || 3000

// Multer configuration for file uploads
const storage = multer.memoryStorage()
const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true)
        } else {
            cb(new Error('Solo se permiten archivos PDF'), false)
        }
    }
})

// Middleware
app.use(cors({
    origin: function (origin, callback) {
        const dominios_permitidos = [
            'https://budabot.com.ar',
            'https://www.budabot.com.ar',
            'https://huapi.com.ar',
            'https://www.huapi.com.ar',
            'https://tannery.com.ar',
            'https://www.tannery.com.ar',
            'https://pazcel.com.ar',
            'https://www.pazcel.com.ar',
            'https://pazcel.com',
            'https://www.pazcel.com',
            'https://breakmkt.com.ar',
            'https://breakmkt.com.ar/preston/',
            'https://preston.com.ar',
            'https://www.preston.com.ar',
            'https://coas.com.ar',
            'https://www.coas.com.ar',
            'https://talent.breakmkt.com.ar',
            'https://www.talent.breakmkt.com.ar',
            'https://marlaca-realestate.com',
            'https://www.marlaca-realestate.com'
        ]

        if (!origin || dominios_permitidos.indexOf(origin) !== -1) {
            callback(null, true)
        } else {
            callback(new Error('CORS'))
        }
    },
    credentials: true
}))
app.use(express.json({
    verify: (req, _res, buf) => { req.rawBody = buf }
}))

// Ruta test
app.get('/', (req, res) => {
    res.json({ mensaje: 'pong' })
})

// Kommo: Ruta para crear un contacto
app.post('/api/kommo-contacto', async (req, res) => {

    // Constantes para definir el destino del contacto: Tannery o Huapyi
    const kommo_huapi_subdominio = process.env.KOMMO_HUAPI_SUBDOMINIO
    const kommo_huapi_token = process.env.KOMMO_HUAPI_TOKEN
    const kommo_huapi_pipeline_id = 9384051
    const kommo_huapi_pipeline_etapa_id = 83070567

    const kommo_tannery_subdominio = process.env.KOMMO_TANNERY_SUBDOMINIO
    const kommo_tannery_token = process.env.KOMMO_TANNERY_TOKEN
    const kommo_tannery_pipeline_id = 9384115
    const kommo_tannery_pipeline_etapa_id = 83069403

    // Lógica para determinar a qué Kommo enviar el contacto: Tannery o Huapi
    const origen = req.headers.origin || req.headers.referer
    if (!origen) {
        return res.status(403).json({ error: 'Acceso denegado' })
    }

    // Extraer el dominio del origen
    const url = new URL(origen)
    const dominio = url.hostname

    // Normalizar dominio (quitar www si existe)
    const dominio_normalizado = dominio.replace('www.', '')

    let subdominio, token, kommo_pipeline_id, kommo_pipeline_etapa_id;

    if (dominio_normalizado === 'huapi.com.ar') {
        subdominio = kommo_huapi_subdominio
        token = kommo_huapi_token
        kommo_pipeline_id = kommo_huapi_pipeline_id
        kommo_pipeline_etapa_id = kommo_huapi_pipeline_etapa_id
        console.log('Kommo - Destino: HUAPI')

    } else if (dominio_normalizado === 'tannery.com.ar') {
        subdominio = kommo_tannery_subdominio
        token = kommo_tannery_token
        kommo_pipeline_id = kommo_tannery_pipeline_id
        kommo_pipeline_etapa_id = kommo_tannery_pipeline_etapa_id
        console.log('Kommo - Destino: TANNERY');

    } else {
        return res.status(403).json({
            error: 'Dominio no autorizado',
            dominio: dominio_normalizado
        });
    }

    try {
        // Datos para enviar a Kommo
        const { nombre_completo, email, telefono, nota } = req.body
        if (!nombre_completo || !email || !telefono) {
            return res.status(400).json({
                success: false,
                mensaje: 'Faltan datos obligatorios'
            })
        }

        // Configuración base de Kommo
        const kommo_api = axios.create({
            baseURL: `https://${subdominio}.kommo.com/api/v4`,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json; charset=utf-8'
            }
        })

        // Contacto payload
        const contacto_data = {
            name: nombre_completo,
            custom_fields_values: [
                {
                    field_code: 'EMAIL',
                    values: [{
                        enum_code: 'WORK',
                        value: email
                    }]
                },
                {
                    field_code: 'PHONE',
                    values: [{
                        enum_code: 'WORK',
                        value: telefono
                    }]
                }
            ]
        }

        // Kommo: creación del contacto
        const contacto_respuesta = await kommo_api.post('/contacts', [contacto_data])
        const contacto_id = contacto_respuesta.data._embedded.contacts[0].id
        console.log('Kommo - Contacto:', contacto_id)

        // Lead payload
        const lead_data = {
            name: `${nombre_completo} - Formulario web`,
            pipeline_id: kommo_pipeline_id, // Modificar
            status_id: kommo_pipeline_etapa_id,  // Modificar
            _embedded: {
                contacts: [{
                    id: contacto_id
                }]
            }
        }

        // Kommo: creación del lead
        const lead_respuesta = await kommo_api.post('/leads', [lead_data])
        const lead_id = lead_respuesta.data._embedded.leads[0].id
        console.log('Kommo - Lead:', lead_id)

        // Kommo: creación de la nota de contacto si existe
        if (nota && nota.trim() !== '') {
            const nota_data = {
                entity_id: contacto_id,
                note_type: 'common',
                params: {
                    text: nota
                }
            }

            await kommo_api.post('/contacts/notes', [nota_data])
        }

        // Respuesta cliente
        res.json({
            success: true,
            mensaje: 'Hemos enviado su contacto correctamente'
        })

    } catch (error) {
        console.error('Kommo - Error:', error.response?.data || error.message)
        res.status(500).json({
            success: false,
            mensaje: 'Error al crear contacto',
            detalles: error.response?.data || error.message
        })
    }
})

// Kommo: Ruta para crear un contacto y un lead en el embudo 'breal' con etiqueta
app.post('/preston', async (req, res) => {
    const kommo_preston_subdominio = process.env.KOMMO_PRESTON_SUBDOMINIO
    const kommo_preston_token = process.env.KOMMO_PRESTON_TOKEN
    const kommo_preston_pipeline_id = 8704063        // Pipeline "Embudo de ventas"

    const kommo_preston_pipeline_etapa_id = 68359371  // Etapa "INGRESO"

    try {
        const { nombre, apellido, nombre_completo: nc, email, telefono, categoria, dni } = req.body
        const nombre_completo = nombre && apellido ? `${nombre} ${apellido}` : (nc || '')
        const first_name = nombre || nombre_completo.trim().split(/\s+/)[0] || ''
        const last_name = apellido || nombre_completo.trim().split(/\s+/).slice(1).join(' ') || ''

        if (!nombre_completo || !telefono || !categoria) {
            return res.status(400).json({
                success: false,
                mensaje: 'Faltan datos obligatorios: nombre, apellido, telefono, categoria'
            })
        }

        let dni_normalizado = null;
        if (dni) {
            dni_normalizado = dni.replace(/[^0-9]/g, '');
        }

        // Normalizar teléfono a formato internacional Argentina (549XXXXXXXXXX)
        let telefono_normalizado = telefono.replace(/[^0-9]/g, '')
        if (!telefono_normalizado.startsWith('549')) {
            if (telefono_normalizado.startsWith('0')) {
                telefono_normalizado = '54' + telefono_normalizado.slice(1)
            } else if (!telefono_normalizado.startsWith('54')) {
                telefono_normalizado = '549' + telefono_normalizado
            }
        }

        const kommo_api = axios.create({
            baseURL: `https://${kommo_preston_subdominio}.kommo.com/api/v4`,
            headers: {
                'Authorization': `Bearer ${kommo_preston_token}`,
                'Content-Type': 'application/json; charset=utf-8'
            }
        })

        // 0. Buscar contacto existente por teléfono o DNI
        async function buscarContacto(query) {
            try {
                const resp = await kommo_api.get(`/contacts?query=${encodeURIComponent(query)}&limit=10`)
                return resp.data?._embedded?.contacts || []
            } catch (e) {
                if (e.response?.status === 204) return []
                throw e
            }
        }

        const candidatos = []
        const porTelefono = await buscarContacto(telefono_normalizado)
        candidatos.push(...porTelefono)
        if (dni_normalizado) {
            const porDni = await buscarContacto(dni_normalizado)
            candidatos.push(...porDni)
        }

        const duplicado = candidatos.find(c => {
            const fields = c.custom_fields_values || []
            const telMatch = fields.some(f => f.field_code === 'PHONE' && f.values.some(v => {
                const num = (v.value || '').replace(/[^0-9]/g, '')
                return num && (num === telefono_normalizado || num.endsWith(telefono_normalizado.slice(-10)))
            }))
            const dniMatch = dni_normalizado && fields.some(f => f.field_id === 1986662 && f.values.some(v =>
                String(v.value || '').replace(/[^0-9]/g, '') === dni_normalizado
            ))
            return telMatch || dniMatch
        })

        if (duplicado) {
            console.log(`Kommo - Duplicado detectado, contacto existente: ${duplicado.id}. Skip silencioso.`)
            return res.json({
                success: true,
                mensaje: 'Solicitud procesada correctamente'
            })
        }

        // 1. Crear Contacto
        const contacto_data = {
            name: nombre_completo,
            first_name: first_name,
            last_name: last_name,
            custom_fields_values: [
                {
                    field_code: 'PHONE',
                    values: [{
                        enum_code: 'WORK',
                        value: telefono_normalizado
                    }]
                },
                {
                    field_id: 1986017,
                    values: [{ value: first_name }]
                }
            ]
        }

        if (email) {
            contacto_data.custom_fields_values.push({
                field_code: 'EMAIL',
                values: [{
                    enum_code: 'WORK',
                    value: email
                }]
            });
        }

        if (dni_normalizado) {
            contacto_data.custom_fields_values.push({
                field_id: 1986662,
                values: [{
                    value: dni_normalizado
                }]
            });
        }

        const contacto_respuesta = await kommo_api.post('/contacts', [contacto_data])
        const contacto_id = contacto_respuesta.data._embedded.contacts[0].id
        console.log('Kommo - Contacto Preston:', contacto_id)

        // 2. Obtener o crear etiqueta
        let tag_id = null;
        if (categoria && categoria.trim() !== '') {
            try {
                // Buscar la etiqueta en el pipeline de leads
                const tags_response = await kommo_api.get('/leads/tags');

                const existing_tag = tags_response.data?._embedded?.tags?.find(
                    tag => tag.name.toLowerCase() === categoria.toLowerCase()
                );

                if (existing_tag) {
                    tag_id = existing_tag.id;
                    console.log(`Kommo - Etiqueta existente encontrada: ${categoria} (ID: ${tag_id})`);
                } else {
                    // Crear la etiqueta si no existe
                    const new_tag_response = await kommo_api.post('/leads/tags', [{ name: categoria }]);
                    tag_id = new_tag_response.data._embedded.tags[0].id;
                    console.log(`Kommo - Nueva etiqueta creada: ${categoria} (ID: ${tag_id})`);
                }
            } catch (tagError) {
                console.error('Kommo - Error al gestionar etiqueta:', tagError.response?.data || tagError.message);
                // Continuar sin etiqueta si hay error
            }
        }

        // 3. Crear Lead
        const lead_data = {
            name: `${nombre_completo} - onboarding`,
            pipeline_id: kommo_preston_pipeline_id,
            status_id: kommo_preston_pipeline_etapa_id,
            _embedded: {
                contacts: [{ id: contacto_id }],
                tags: tag_id ? [{ id: tag_id }] : (categoria ? [{ name: categoria }] : [])
            }
        }

        const lead_respuesta = await kommo_api.post('/leads', [lead_data])
        const lead_id = lead_respuesta.data._embedded.leads[0].id
        console.log('Kommo - Lead Preston:', lead_id)

        // Agregar etiqueta al lead
        if (tag_id) {
            try {
                const lead_tag_data = {
                    _embedded: {
                        tags: [{
                            id: tag_id
                        }]
                    }
                };
                await kommo_api.patch(`/leads/${lead_id}`, lead_tag_data);
                console.log(`Kommo - Etiqueta '${categoria}' agregada al Lead ${lead_id}`);
            } catch (leadTagError) {
                console.error('Kommo - Error al agregar etiqueta al lead:', leadTagError.response?.data || leadTagError.message);
            }
        }

        // 4. Agregar etiqueta al contacto (si existe y no se agregó antes)
        if (tag_id) {
            try {
                const contact_tag_data = {
                    _embedded: {
                        tags: [{
                            id: tag_id
                        }]
                    }
                };
                await kommo_api.patch(`/contacts/${contacto_id}`, contact_tag_data);
                console.log(`Kommo - Etiqueta '${categoria}' agregada al Contacto ${contacto_id}`);
            } catch (contactTagError) {
                console.error('Kommo - Error al agregar etiqueta al contacto:', contactTagError.response?.data || contactTagError.message);
            }
        }

        res.json({
            success: true,
            mensaje: 'Contacto y Lead creados con éxito en Kommo CRM (Preston)',
            datos: {
                contacto_id,
                lead_id,
                tag_id
            }
        })

    } catch (error) {
        console.error('Kommo - Error en Preston:', error.response?.data || error.message)
        res.status(500).json({
            success: false,
            mensaje: 'Error al procesar el formulario Preston',
            detalles: error.response?.data || error.message
        })
    }
})

// ==================================================================
// PRESTON — Onboarding v2
// ==================================================================
// Multer específico para v2: acepta PDF, JPG, PNG (hasta 10MB/archivo)
const uploadPrestonV2 = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ok = ['application/pdf', 'image/jpeg', 'image/png'].includes(file.mimetype)
        cb(ok ? null : new Error('Solo PDF, JPG o PNG'), ok)
    }
})

// Preston v2 — pipeline "Embudo leads onboarding" (14199764)
//   Paso 2 → ONBOARDING INCOMPLETO (109639704)
//   Paso 3 → leads entrantes onboarding (109632916)
const PRESTON_V2_PIPELINE_ID = 14199764
const PRESTON_V2_ETAPA_INCOMPLETO = 109639704
const PRESTON_V2_ETAPA_COMPLETO = 109632916
// Pipeline v1 "En desuso: Embudo de ventas". Si un lead activo del contacto
// vive acá, se transfiere al pipeline onboarding en vez de crear uno nuevo.
const PRESTON_V1_LEGACY_PIPELINE_ID = 8704063
// Custom field "Teléfono" en Lead. Se replica el número del contacto acá para
// que Kommo pueda matchear el chat de WhatsApp al lead correcto.
const PRESTON_V2_LEAD_TELEFONO_FIELD_ID = 1990819
// Custom field "intento" en Lead. Cuenta cuántas veces el contacto retomó
// el onboarding (1 al crear, +1 en cada reutilización).
const PRESTON_V2_LEAD_INTENTO_FIELD_ID = 1990845

// YAFUE — cuenta Kommo separada (soporteyafuear). Los leads con
// categoria='YAFUE' se derivan acá en vez de a Preston.
const YAFUE_PIPELINE_ID = 14176460          // "Proceso comercial"
const YAFUE_ETAPA_INCOMING = 110808324      // "INGRESO PRESTON"
// Custom fields creados en la cuenta YAFUE (paridad con Preston).
const YAFUE_LEAD_TELEFONO_FIELD_ID = 1748293    // Lead · "Teléfono"
const YAFUE_LEAD_INTENTO_FIELD_ID = 1748289     // Lead · "intento"
const YAFUE_CONTACT_DNI_FIELD_ID = 1748291      // Contact · "DNI"

// Handler: crea/reutiliza contacto + lead en la cuenta YAFUE con la MISMA
// lógica que el flujo Preston (dedupe, reutilización, intento++, nota de
// intento, nota Paso 2, tags, custom fields de teléfono e intento).
async function handlePrestonV2Yafue(req, res, datos) {
    const subdominio = process.env.KOMMO_YAFUE_SUBDOMINIO
    const token = process.env.KOMMO_YAFUE_TOKEN
    if (!subdominio || !token) {
        return res.status(500).json({
            success: false,
            mensaje: 'YAFUE no configurado (faltan KOMMO_YAFUE_SUBDOMINIO / KOMMO_YAFUE_TOKEN).'
        })
    }
    const {
        categoria, motivo_yafue, situacion_laboral, jurisdiccion,
        tipo_label, categoria_label, detalle_label,
        nombre, apellido, telefono_normalizado, dni_normalizado, email,
        nombre_completo
    } = datos

    const kommo_api = axios.create({
        baseURL: `https://${subdominio}.kommo.com/api/v4`,
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' }
    })

    try {
        // 0. Buscar contacto duplicado por teléfono o DNI (misma lógica que Preston)
        async function buscarContacto(query) {
            try {
                const r = await kommo_api.get(`/contacts?query=${encodeURIComponent(query)}&limit=10`)
                return r.data?._embedded?.contacts || []
            } catch (e) {
                if (e.response?.status === 204) return []
                throw e
            }
        }
        const candidatos = [
            ...(await buscarContacto(telefono_normalizado)),
            ...(dni_normalizado ? await buscarContacto(dni_normalizado) : [])
        ]
        const duplicado = candidatos.find(c => {
            const fields = c.custom_fields_values || []
            const telMatch = fields.some(f => f.field_code === 'PHONE' && f.values.some(v => {
                const num = (v.value || '').replace(/[^0-9]/g, '')
                return num && (num === telefono_normalizado || num.endsWith(telefono_normalizado.slice(-10)))
            }))
            const dniMatch = dni_normalizado && fields.some(f => f.field_id === YAFUE_CONTACT_DNI_FIELD_ID && f.values.some(v =>
                String(v.value || '').replace(/[^0-9]/g, '') === dni_normalizado
            ))
            return telMatch || dniMatch
        })

        // 1. Crear o reutilizar contacto
        let contacto_id
        if (duplicado) {
            contacto_id = duplicado.id
        } else {
            const contacto_data = {
                name: nombre_completo,
                first_name: nombre,
                last_name: apellido,
                custom_fields_values: [
                    { field_code: 'PHONE', values: [{ enum_code: 'WORK', value: telefono_normalizado }] }
                ]
            }
            if (dni_normalizado) {
                contacto_data.custom_fields_values.push({
                    field_id: YAFUE_CONTACT_DNI_FIELD_ID, values: [{ value: dni_normalizado }]
                })
            }
            if (email) {
                contacto_data.custom_fields_values.push({
                    field_code: 'EMAIL', values: [{ enum_code: 'WORK', value: email }]
                })
            }
            const cr = await kommo_api.post('/contacts', [contacto_data])
            contacto_id = cr.data._embedded.contacts[0].id
        }

        // 2. Tags: categoría ('YAFUE') + motivo de derivación como sub-tag
        async function getOrCreateTag(name) {
            if (!name || !String(name).trim()) return null
            try {
                const r = await kommo_api.get('/leads/tags')
                const existing = r.data?._embedded?.tags?.find(t => t.name.toLowerCase() === String(name).toLowerCase())
                if (existing) return existing.id
                const nr = await kommo_api.post('/leads/tags', [{ name }])
                return nr.data._embedded.tags[0].id
            } catch (e) { return null }
        }
        const tag_cat_id = await getOrCreateTag('YAFUE')
        const tag_motivo_id = await getOrCreateTag(motivo_yafue)
        const tags = []
        if (tag_cat_id) tags.push({ id: tag_cat_id }); else tags.push({ name: 'YAFUE' })
        if (tag_motivo_id) tags.push({ id: tag_motivo_id })
        else if (motivo_yafue) tags.push({ name: motivo_yafue })

        // 3. Buscar lead activo del contacto en el pipeline YAFUE
        let lead_existente = null
        try {
            const cr2 = await kommo_api.get(`/contacts/${contacto_id}?with=leads`)
            const leadIds = (cr2.data?._embedded?.leads || []).map(l => l.id)
            if (leadIds.length > 0) {
                const idsQS = leadIds.map(id => `filter[id][]=${id}`).join('&')
                const lr = await kommo_api.get(`/leads?${idsQS}&limit=250`)
                const leads = lr.data?._embedded?.leads || []
                lead_existente = leads.find(l =>
                    l.pipeline_id === YAFUE_PIPELINE_ID &&
                    l.status_id !== 142 && l.status_id !== 143
                ) || null
            }
        } catch (e) { /* seguimos y creamos */ }

        let lead_id
        let lead_reutilizado = false
        let intento_actual = 0
        if (lead_existente) {
            lead_id = lead_existente.id
            lead_reutilizado = true

            const intento_field = (lead_existente.custom_fields_values || [])
                .find(f => f.field_id === YAFUE_LEAD_INTENTO_FIELD_ID)
            const intento_leido = parseInt(intento_field?.values?.[0]?.value || 0, 10) || 0
            intento_actual = Math.max(intento_leido, 1)
            const nuevo_intento = intento_actual + 1

            // Update completo: refresca nombre, tags, teléfono, intento con
            // los datos del intento actual.
            const update = {
                name: `${nombre_completo} - onboarding v2`,
                custom_fields_values: [
                    { field_id: YAFUE_LEAD_TELEFONO_FIELD_ID, values: [{ value: telefono_normalizado }] },
                    { field_id: YAFUE_LEAD_INTENTO_FIELD_ID, values: [{ value: nuevo_intento }] }
                ],
                _embedded: { tags }
            }
            try {
                await kommo_api.patch(`/leads/${lead_id}`, update)
            } catch (updErr) {
                console.error('YAFUE - Error actualizando lead reutilizado:', updErr.response?.data || updErr.message)
            }

            // Nota "Nuevo intento #N — fecha"
            const fecha = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })
            try {
                await kommo_api.post(`/leads/${lead_id}/notes`, [{
                    note_type: 'common',
                    params: { text: `🔁 Nuevo intento #${nuevo_intento} — ${fecha}` }
                }])
            } catch (e) { /* soft-fail */ }
        } else {
            // Crear lead nuevo con intento=1
            const lead_data = {
                name: `${nombre_completo} - onboarding v2`,
                pipeline_id: YAFUE_PIPELINE_ID,
                status_id: YAFUE_ETAPA_INCOMING,
                custom_fields_values: [
                    { field_id: YAFUE_LEAD_TELEFONO_FIELD_ID, values: [{ value: telefono_normalizado }] },
                    { field_id: YAFUE_LEAD_INTENTO_FIELD_ID, values: [{ value: 1 }] }
                ],
                _embedded: { contacts: [{ id: contacto_id }], tags }
            }
            const lr = await kommo_api.post('/leads', [lead_data])
            lead_id = lr.data._embedded.leads[0].id
        }

        // 4. Nota Paso 2 con los datos del intento actual (siempre)
        const nota_lines = ['📋 Onboarding v2 — Paso 2 (Preston → YAFUE)', '']
        nota_lines.push(`Motivo derivación: ${motivo_yafue || '-'}`)
        if (tipo_label) nota_lines.push(`Tipo: ${tipo_label}`)
        else if (situacion_laboral) nota_lines.push(`Tipo: ${situacion_laboral}`)
        if (categoria_label) nota_lines.push(`Categoría: ${categoria_label}`)
        if (detalle_label) nota_lines.push(`Detalle: ${detalle_label}`)
        if (jurisdiccion) nota_lines.push(`Jurisdicción: ${jurisdiccion}`)
        if (email) nota_lines.push(`Email: ${email}`)
        try {
            await kommo_api.post(`/leads/${lead_id}/notes`, [{
                note_type: 'common',
                params: { text: nota_lines.join('\n') }
            }])
        } catch (e) { /* soft-fail */ }

        return res.json({
            success: true,
            destino: 'yafue',
            lead_id,
            contacto_id,
            lead_reutilizado,
            intento: lead_reutilizado ? intento_actual + 1 : 1,
            mensaje: lead_reutilizado
                ? 'Contacto y Lead ya existían en YAFUE, reutilizados'
                : 'Contacto y Lead creados en YAFUE'
        })
    } catch (error) {
        console.error('Preston v2 → YAFUE - Error:', error.response?.data || error.message)
        return res.status(500).json({
            success: false,
            destino: 'yafue',
            mensaje: 'Error al procesar en YAFUE',
            detalles: error.response?.data || error.message
        })
    }
}

// POST /preston-v2 → Paso 2: crea contacto + lead con tags y devuelve { lead_id }
app.post('/preston-v2', async (req, res) => {
    const subdominio = process.env.KOMMO_PRESTON_SUBDOMINIO
    const token = process.env.KOMMO_PRESTON_TOKEN
    const pipeline_id = PRESTON_V2_PIPELINE_ID
    const etapa_id = PRESTON_V2_ETAPA_INCOMPLETO

    try {
        const {
            categoria, sub_categoria, motivo_yafue,
            situacion_laboral, jurisdiccion,
            tipo_label, categoria_label, detalle_label,
            nombre, apellido, telefono, dni, email
        } = req.body

        if (!nombre || !apellido || !telefono || !dni || !categoria) {
            return res.status(400).json({
                success: false,
                mensaje: 'Faltan datos obligatorios: nombre, apellido, telefono, dni, categoria'
            })
        }

        const nombre_completo = `${nombre} ${apellido}`.trim()
        const dni_normalizado = String(dni).replace(/[^0-9]/g, '')
        let telefono_normalizado = String(telefono).replace(/[^0-9]/g, '')
        if (!telefono_normalizado.startsWith('549')) {
            if (telefono_normalizado.startsWith('0')) {
                telefono_normalizado = '54' + telefono_normalizado.slice(1)
            } else if (!telefono_normalizado.startsWith('54')) {
                telefono_normalizado = '549' + telefono_normalizado
            }
        }

        // Los leads con categoría YAFUE viven en otra cuenta de Kommo
        // (soporteyafuear). Se derivan y se cortocircuita el flujo Preston.
        if (categoria === 'YAFUE') {
            return handlePrestonV2Yafue(req, res, {
                categoria, motivo_yafue, situacion_laboral, jurisdiccion,
                tipo_label, categoria_label, detalle_label,
                nombre, apellido, telefono_normalizado, dni_normalizado, email,
                nombre_completo
            })
        }

        const kommo_api = axios.create({
            baseURL: `https://${subdominio}.kommo.com/api/v4`,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json; charset=utf-8'
            }
        })

        // 0. Detectar contacto duplicado por teléfono o DNI (para reutilizar)
        async function buscarContacto(query) {
            try {
                const r = await kommo_api.get(`/contacts?query=${encodeURIComponent(query)}&limit=10`)
                return r.data?._embedded?.contacts || []
            } catch (e) {
                if (e.response?.status === 204) return []
                throw e
            }
        }
        const candidatos = [
            ...(await buscarContacto(telefono_normalizado)),
            ...(dni_normalizado ? await buscarContacto(dni_normalizado) : [])
        ]
        const duplicado = candidatos.find(c => {
            const fields = c.custom_fields_values || []
            const telMatch = fields.some(f => f.field_code === 'PHONE' && f.values.some(v => {
                const num = (v.value || '').replace(/[^0-9]/g, '')
                return num && (num === telefono_normalizado || num.endsWith(telefono_normalizado.slice(-10)))
            }))
            const dniMatch = dni_normalizado && fields.some(f => f.field_id === 1986662 && f.values.some(v =>
                String(v.value || '').replace(/[^0-9]/g, '') === dni_normalizado
            ))
            return telMatch || dniMatch
        })

        // 1. Crear o reutilizar contacto
        let contacto_id
        if (duplicado) {
            contacto_id = duplicado.id
            console.log(`Preston v2 - Contacto duplicado, reutilizando: ${contacto_id}`)
        } else {
            const contacto_data = {
                name: nombre_completo,
                first_name: nombre,
                last_name: apellido,
                custom_fields_values: [
                    { field_code: 'PHONE', values: [{ enum_code: 'WORK', value: telefono_normalizado }] },
                    { field_id: 1986017, values: [{ value: nombre }] },
                    { field_id: 1986662, values: [{ value: dni_normalizado }] }
                ]
            }
            if (email) {
                contacto_data.custom_fields_values.push({
                    field_code: 'EMAIL', values: [{ enum_code: 'WORK', value: email }]
                })
            }
            const cr = await kommo_api.post('/contacts', [contacto_data])
            contacto_id = cr.data._embedded.contacts[0].id
            console.log('Preston v2 - Contacto creado:', contacto_id)
        }

        // 2. Gestionar tags: categoría + sub_categoría (si aplica)
        async function getOrCreateTag(name) {
            if (!name || !String(name).trim()) return null
            try {
                const r = await kommo_api.get('/leads/tags')
                const existing = r.data?._embedded?.tags?.find(t => t.name.toLowerCase() === String(name).toLowerCase())
                if (existing) return existing.id
                const nr = await kommo_api.post('/leads/tags', [{ name }])
                return nr.data._embedded.tags[0].id
            } catch (e) {
                console.error('Preston v2 - Error tag', name, e.response?.data || e.message)
                return null
            }
        }
        const tag_cat_id = await getOrCreateTag(categoria)
        const tag_sub_id = await getOrCreateTag(sub_categoria)

        // 3. Verificar si el contacto ya tiene un lead ACTIVO en los pipelines
        //    aceptados: el nuevo (onboarding) y el viejo (v1 legacy en desuso).
        //    "Activo" = no está en 142 (Ganados) ni en 143 (Perdidos).
        //    NOTA: `filter[contacts][]` en /leads no filtra realmente por contacto
        //    (Kommo lo ignora). Vamos por /contacts/{id}?with=leads para obtener
        //    los IDs vinculados y después traemos esos leads.
        const PIPELINES_ACEPTADOS = [PRESTON_V2_PIPELINE_ID, PRESTON_V1_LEGACY_PIPELINE_ID]
        let lead_existente = null
        try {
            const cr = await kommo_api.get(`/contacts/${contacto_id}?with=leads`)
            const leadIds = (cr.data?._embedded?.leads || []).map(l => l.id)
            if (leadIds.length > 0) {
                const idsQS = leadIds.map(id => `filter[id][]=${id}`).join('&')
                const lr = await kommo_api.get(`/leads?${idsQS}&limit=250`)
                const leads = lr.data?._embedded?.leads || []
                // Prioridad: el pipeline onboarding gana sobre el legacy si hay leads en ambos
                lead_existente =
                    leads.find(l => l.pipeline_id === PRESTON_V2_PIPELINE_ID && l.status_id !== 142 && l.status_id !== 143) ||
                    leads.find(l => l.pipeline_id === PRESTON_V1_LEGACY_PIPELINE_ID && l.status_id !== 142 && l.status_id !== 143) ||
                    null
                if (lead_existente) {
                    console.log(`Preston v2 - Lead existente: ${lead_existente.id} (pipeline ${lead_existente.pipeline_id}, status ${lead_existente.status_id}). Reutilizando.`)
                }
            }
        } catch (e) {
            if (e.response?.status !== 204) {
                console.error('Preston v2 - Error buscando leads existentes:', e.response?.data || e.message)
            }
        }

        // Tags a aplicar al lead (mismos para creación y reutilización)
        const tags = []
        if (tag_cat_id) tags.push({ id: tag_cat_id })
        else if (categoria) tags.push({ name: categoria })
        if (tag_sub_id) tags.push({ id: tag_sub_id })
        else if (sub_categoria) tags.push({ name: sub_categoria })

        let lead_id
        let lead_reutilizado = false
        let lead_transferido = false
        let intento_actual = 0
        if (lead_existente) {
            lead_id = lead_existente.id
            lead_reutilizado = true

            // Leer el intento actual del lead. Si el campo no existe (lead
            // previo a la introducción de "intento") su existencia igual
            // cuenta como intento #1, así el reintento actual queda como #2.
            const intento_field = (lead_existente.custom_fields_values || [])
                .find(f => f.field_id === PRESTON_V2_LEAD_INTENTO_FIELD_ID)
            const intento_leido = parseInt(intento_field?.values?.[0]?.value || 0, 10) || 0
            intento_actual = Math.max(intento_leido, 1)
            const nuevo_intento = intento_actual + 1

            // Update completo: refresca nombre, teléfono, tags e intento con los
            // datos nuevos que el usuario cargó en el onboarding v2. Si el lead
            // vivía en el pipeline legacy, además se transfiere al onboarding.
            const update = {
                name: `${nombre_completo} - onboarding v2`,
                custom_fields_values: [
                    { field_id: PRESTON_V2_LEAD_TELEFONO_FIELD_ID, values: [{ value: telefono_normalizado }] },
                    { field_id: PRESTON_V2_LEAD_INTENTO_FIELD_ID, values: [{ value: nuevo_intento }] }
                ],
                _embedded: { tags }
            }
            if (lead_existente.pipeline_id === PRESTON_V1_LEGACY_PIPELINE_ID) {
                update.pipeline_id = PRESTON_V2_PIPELINE_ID
                update.status_id = PRESTON_V2_ETAPA_INCOMPLETO
                lead_transferido = true
            }
            try {
                await kommo_api.patch(`/leads/${lead_id}`, update)
                console.log(`Preston v2 - Lead ${lead_id} actualizado (intento ${nuevo_intento}${lead_transferido ? ', transferido de legacy' : ''})`)
            } catch (updErr) {
                console.error('Preston v2 - Error actualizando lead reutilizado:', updErr.response?.data || updErr.message)
            }

            // Nota con la fecha del nuevo intento
            const fecha = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })
            const nota_txt = `🔁 Nuevo intento #${nuevo_intento} — ${fecha}` +
                (lead_transferido ? '\nLead transferido desde "En desuso: Embudo de ventas" al Embudo leads onboarding.' : '')
            try {
                await kommo_api.post(`/leads/${lead_id}/notes`, [{
                    note_type: 'common',
                    params: { text: nota_txt }
                }])
            } catch (noteErr) {
                console.error('Preston v2 - Error creando nota de intento:', noteErr.response?.data || noteErr.message)
            }
        } else {
            // 3b. Crear lead nuevo con nombre "{nombre_completo} - onboarding v2" e intento=1
            const lead_data = {
                name: `${nombre_completo} - onboarding v2`,
                pipeline_id,
                status_id: etapa_id,
                custom_fields_values: [
                    { field_id: PRESTON_V2_LEAD_TELEFONO_FIELD_ID, values: [{ value: telefono_normalizado }] },
                    { field_id: PRESTON_V2_LEAD_INTENTO_FIELD_ID, values: [{ value: 1 }] }
                ],
                _embedded: {
                    contacts: [{ id: contacto_id }],
                    tags
                }
            }
            const lr = await kommo_api.post('/leads', [lead_data])
            lead_id = lr.data._embedded.leads[0].id
            console.log('Preston v2 - Lead creado (intento=1):', lead_id)
        }

        // 4. Nota con el resto de los datos del Paso 2
        const nota_lines = ['📋 Onboarding v2 — Paso 2', '']
        if (tipo_label) nota_lines.push(`Tipo: ${tipo_label}`)
        else if (situacion_laboral) nota_lines.push(`Tipo: ${situacion_laboral}`)
        if (categoria_label) nota_lines.push(`Categoría: ${categoria_label}`)
        if (detalle_label) nota_lines.push(`Detalle: ${detalle_label}`)
        if (sub_categoria && !detalle_label) nota_lines.push(`Sub-categoría: ${sub_categoria}`)
        if (motivo_yafue) nota_lines.push(`Motivo YAFUE: ${motivo_yafue}`)
        if (jurisdiccion) nota_lines.push(`Jurisdicción: ${jurisdiccion}`)
        if (email) nota_lines.push(`Email: ${email}`)
        if (nota_lines.length > 2) {
            try {
                await kommo_api.post(`/leads/${lead_id}/notes`, [{
                    note_type: 'common',
                    params: { text: nota_lines.join('\n') }
                }])
            } catch (noteErr) {
                console.error('Preston v2 - Error creando nota:', noteErr.response?.data || noteErr.message)
            }
        }

        res.json({
            success: true,
            lead_id,
            contacto_id,
            lead_reutilizado,
            lead_transferido,
            intento: lead_reutilizado ? intento_actual + 1 : 1,
            mensaje: lead_reutilizado
                ? (lead_transferido
                    ? 'Lead reutilizado y transferido de "En desuso" a Embudo onboarding (Preston v2)'
                    : 'Contacto y Lead ya existían, reutilizados (Preston v2)')
                : 'Contacto y Lead creados en Kommo (Preston v2)'
        })

    } catch (error) {
        console.error('Preston v2 - Error POST:', error.response?.data || error.message)
        res.status(500).json({
            success: false,
            mensaje: 'Error al procesar Preston v2',
            detalles: error.response?.data || error.message
        })
    }
})

// PATCH /preston-v2/:leadId → Paso 3: enriquece el lead con datos textuales y adjuntos
app.patch('/preston-v2/:leadId', uploadPrestonV2.any(), async (req, res) => {
    const subdominio = process.env.KOMMO_PRESTON_SUBDOMINIO
    const token = process.env.KOMMO_PRESTON_TOKEN
    const leadId = req.params.leadId

    try {
        let data = {}
        if (req.body.data) {
            try { data = JSON.parse(req.body.data) } catch (e) { /* body sin data JSON válido: seguir con vacío */ }
        }

        const kommo_api = axios.create({
            baseURL: `https://${subdominio}.kommo.com/api/v4`,
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' }
        })

        // 1. Nota con datos textuales del Paso 3
        const nota_lines = ['📋 Onboarding v2 — Paso 3', '']
        if (data.disponible) nota_lines.push(`Disponible por decreto: ${data.disponible}`)
        if (data.disponible_afectacion) nota_lines.push(`Disponible de afectación: ${data.disponible_afectacion}`)
        if (data.banco) nota_lines.push(`Banco de haberes: ${data.banco}`)
        if (data.tarjeta) nota_lines.push(`Tiene pagos de tarjeta: ${data.tarjeta}`)
        if (nota_lines.length > 2) {
            try {
                await kommo_api.post(`/leads/${leadId}/notes`, [{
                    note_type: 'common',
                    params: { text: nota_lines.join('\n') }
                }])
            } catch (noteErr) {
                console.error('Preston v2 - Error creando nota Paso 3:', noteErr.response?.data || noteErr.message)
            }
        }

        // 2. Adjuntar archivos al lead vía drive de Kommo
        const files = req.files || []
        let files_uploaded = 0
        if (files.length > 0) {
            const accountResponse = await axios.get(
                `https://${subdominio}.kommo.com/api/v4/account?with=drive_url`,
                { headers: { 'Authorization': `Bearer ${token}` } }
            )
            const driveUrl = accountResponse.data.drive_url

            for (const file of files) {
                try {
                    // a. Abrir sesión de carga
                    const sessionResponse = await axios.post(
                        `${driveUrl}/v1.0/sessions`,
                        { file_name: file.originalname, file_size: file.buffer.length },
                        { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' } }
                    )
                    const { upload_url, max_part_size } = sessionResponse.data

                    // b. Subir en partes
                    let currentUrl = upload_url
                    let offset = 0
                    let fileData = null
                    while (offset < file.buffer.length) {
                        const partSize = Math.min(max_part_size, file.buffer.length - offset)
                        const part = file.buffer.slice(offset, offset + partSize)
                        const uploadResponse = await axios.post(currentUrl, part, {
                            headers: { 'Content-Type': 'application/octet-stream' }
                        })
                        if (uploadResponse.data.uuid) fileData = uploadResponse.data
                        else if (uploadResponse.data.next_url) currentUrl = uploadResponse.data.next_url
                        offset += partSize
                    }

                    // c. Adjuntar al lead
                    if (fileData) {
                        await axios.put(
                            `https://${subdominio}.kommo.com/api/v4/leads/${leadId}/files`,
                            [{ file_uuid: fileData.uuid }],
                            { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' } }
                        )
                        files_uploaded++
                        console.log(`Preston v2 - Adjuntado a lead ${leadId}: ${file.originalname} (field ${file.fieldname})`)
                    }
                } catch (fileErr) {
                    console.error(`Preston v2 - Error subiendo ${file.originalname}:`, fileErr.response?.data || fileErr.message)
                }
            }
        }

        // 3. Mover el lead a la etapa "completo" (Paso 3 finalizado)
        let etapa_actualizada = false
        try {
            await kommo_api.patch(`/leads/${leadId}`, { status_id: PRESTON_V2_ETAPA_COMPLETO })
            etapa_actualizada = true
            console.log(`Preston v2 - Lead ${leadId} movido a etapa COMPLETO (${PRESTON_V2_ETAPA_COMPLETO})`)
        } catch (stageErr) {
            console.error('Preston v2 - Error moviendo lead a COMPLETO:', stageErr.response?.data || stageErr.message)
        }

        res.json({
            success: true,
            lead_id: leadId,
            files_uploaded,
            etapa_actualizada,
            mensaje: 'Lead enriquecido en Kommo (Preston v2)'
        })

    } catch (error) {
        console.error('Preston v2 - Error PATCH:', error.response?.data || error.message)
        res.status(500).json({
            success: false,
            mensaje: 'Error al enriquecer lead Preston v2',
            detalles: error.response?.data || error.message
        })
    }
})

// Pazcel: Ruta para manejar la respuestas del formulario web
app.post('/api/pazcel', async (req, res) => {
    try {
        const { nombre, email, empresa, ciudad, conferencia, desafio } = req.body

        console.log('Pazcel - Datos recibidos:', req.body)

        // Validación de datos obligatorios
        if (!nombre || !email || !empresa || !ciudad || !conferencia || !desafio) {
            return res.status(400).json({
                success: false,
                mensaje: 'Faltan datos obligatorios'
            })
        }

        // Configurar el transportador de nodemailer
        const transporter = nodemailer.createTransport({
            host: process.env.PAZCEL_SMTP_SERVIDOR,
            port: process.env.PAZCEL_SMTP_PUERTO,
            secure: true, // true para 465, false para otros puertos
            auth: {
                user: process.env.PAZCEL_SMTP_CORREO,
                pass: process.env.PAZCEL_SMTP_PASS,
            },
        })

        // Contenido del email
        const mailOptions = {
            from: process.env.PAZCEL_SMTP_CORREO,
            to: 'hola@pazcel.com.ar',
            subject: 'Contacto Web',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #45c2c6; border-bottom: 3px solid #84c883; padding-bottom: 10px;">
                        Nueva solicitud de información desde la web
                    </h2>
                    
                    <div style="background-color: #f9f9f9; padding: 20px; border-radius: 10px; margin: 20px 0;">
                        <p style="margin: 10px 0;"><strong style="color: #45c2c6;">Nombre:</strong> ${nombre}</p>
                        <p style="margin: 10px 0;"><strong style="color: #45c2c6;">Email:</strong> ${email}</p>
                        <p style="margin: 10px 0;"><strong style="color: #45c2c6;">Empresa:</strong> ${empresa}</p>
                        <p style="margin: 10px 0;"><strong style="color: #45c2c6;">Ciudad:</strong> ${ciudad}</p>
                        <p style="margin: 10px 0;"><strong style="color: #45c2c6;">Conferencia de interés:</strong> ${conferencia}</p>
                    </div>
                    
                    <div style="background-color: #fff; padding: 20px; border-left: 4px solid #84c883; margin: 20px 0;">
                        <p style="margin: 0 0 10px 0;"><strong style="color: #84c883;">Desafío:</strong></p>
                        <p style="margin: 0; line-height: 1.6;">${desafio}</p>
                    </div>
                    
                    <p style="color: #666; font-size: 12px; margin-top: 30px;">
                        Este email fue enviado desde el formulario de contacto de Pazcel
                    </p>
                </div>
            `,
        }

        // Enviar el email
        await transporter.sendMail(mailOptions)

        console.log('Pazcel - Email enviado correctamente')

        // Respuesta al cliente
        res.json({
            success: true,
            mensaje: 'Email enviado correctamente'
        })

    } catch (error) {
        console.error('Pazcel - Error al enviar email:', error)
        res.status(500).json({
            success: false,
            mensaje: 'Error al enviar el email',
            detalles: error.message
        })
    }
})

// Kommo: Ruta para COAS
app.post('/coas', async (req, res) => {
    // Credenciales y IDs para COAS
    const KOMMO_COAS_SUBDOMINIO = process.env.KOMMO_COAS_SUBDOMINIO;
    const KOMMO_COAS_TOKEN = process.env.KOMMO_COAS_TOKEN
    const PIPELINE_ID = 10961771;
    const STATUS_ID = 84103431;

    try {
        const { nombre_completo, telefono, onboarding_respuestas } = req.body;

        if (!nombre_completo || !telefono) {
            return res.status(400).json({
                success: false,
                mensaje: 'Faltan datos obligatorios: nombre_completo y telefono son requeridos.'
            });
        }

        const kommo_api = axios.create({
            baseURL: `https://${KOMMO_COAS_SUBDOMINIO}.kommo.com/api/v4`,
            headers: {
                'Authorization': `Bearer ${KOMMO_COAS_TOKEN}`,
                'Content-Type': 'application/json; charset=utf-8'
            }
        });

        // 1. Crear el Contacto
        const contacto_data = {
            name: nombre_completo,
            custom_fields_values: [
                {
                    field_code: 'PHONE',
                    values: [{
                        enum_code: 'WORK',
                        value: telefono
                    }]
                }
            ]
        };

        const contacto_respuesta = await kommo_api.post('/contacts', [contacto_data]);
        const contacto_id = contacto_respuesta.data._embedded.contacts[0].id;
        console.log(`Kommo COAS - Contacto creado: ${contacto_id}`);

        // 2. Crear el Lead y vincularlo al contacto
        const lead_data = {
            name: `${nombre_completo} - onboarding`,
            pipeline_id: PIPELINE_ID,
            status_id: STATUS_ID,
            _embedded: {
                contacts: [{
                    id: contacto_id
                }]
            }
        };

        const lead_respuesta = await kommo_api.post('/leads', [lead_data]);
        const lead_id = lead_respuesta.data._embedded.leads[0].id;
        console.log(`Kommo COAS - Lead creado: ${lead_id}`);

        // 3. Formatear y agregar la nota con las respuestas del onboarding
        if (onboarding_respuestas && Array.isArray(onboarding_respuestas) && onboarding_respuestas.length > 0) {
            let nota_texto = 'Respuestas del Onboarding:\n\n';
            onboarding_respuestas.forEach(item => {
                nota_texto += `P: ${item.question}\nR: ${item.answer}\n\n`;
            });

            const nota_data = [{
                entity_id: lead_id, // Cambiado a lead_id
                note_type: 'common',
                params: {
                    text: nota_texto
                }
            }];

            await kommo_api.post(`/leads/${lead_id}/notes`, nota_data); // Cambiado a /leads/${lead_id}/notes
            console.log(`Kommo COAS - Nota agregada al lead ${lead_id}`);
        }
        
        res.status(201).json({
            success: true,
            mensaje: 'Contacto y Lead creados exitosamente en Kommo para COAS.',
            data: {
                contact_id: contacto_id,
                lead_id: lead_id
            }
        });

    } catch (error) {
        console.error('Kommo COAS - Error:', error.response?.data || error.message);
        res.status(500).json({
            success: false,
            mensaje: 'Error al procesar la solicitud para COAS.',
            detalles: error.response?.data || error.message
        });
    }
});


// =====================================================
// BUDABOT: Endpoint para onboarding de negocios
// =====================================================

// Configuración de Kommo para Budabot (usa misma cuenta que Break Talent)
const KOMMO_BUDABOT_SUBDOMINIO = process.env.KOMMO_TALENT_SUBDOMINIO
const KOMMO_BUDABOT_TOKEN = process.env.KOMMO_TALENT_TOKEN
// NOTA: Usa el pipeline "Embudo de ventas" existente, etapa "Incoming leads"
// El plan de Kommo no permite crear ni modificar pipelines (error 402)
const BUDABOT_PIPELINE_ID = 12288287 // Pipeline "Embudo de ventas"
const BUDABOT_STATUS_ID = 94974739 // Etapa "Incoming leads"

// Endpoint para recibir datos del onboarding de Budabot
app.post('/budabot', async (req, res) => {
    try {
        const { nombre_completo, email, telefono, posicion, sitio_web, onboarding_respuestas } = req.body;

        // Validación de campos obligatorios
        if (!nombre_completo || !email || !telefono || !posicion) {
            return res.status(400).json({
                success: false,
                mensaje: 'Faltan datos obligatorios: nombre_completo, email, telefono y posicion son requeridos.'
            });
        }

        // Verificar que los IDs de pipeline estén configurados
        if (!BUDABOT_PIPELINE_ID || !BUDABOT_STATUS_ID) {
            return res.status(500).json({
                success: false,
                mensaje: 'El pipeline de Budabot no está configurado. Por favor, crea el pipeline y actualiza los IDs en el código.'
            });
        }

        const kommo_api = axios.create({
            baseURL: `https://${KOMMO_BUDABOT_SUBDOMINIO}.kommo.com/api/v4`,
            headers: {
                'Authorization': `Bearer ${KOMMO_BUDABOT_TOKEN}`,
                'Content-Type': 'application/json; charset=utf-8'
            }
        });

        // 1. Crear el Contacto con email y teléfono
        const custom_fields = [
            {
                field_code: 'PHONE',
                values: [{
                    enum_code: 'WORK',
                    value: telefono
                }]
            },
            {
                field_code: 'EMAIL',
                values: [{
                    enum_code: 'WORK',
                    value: email
                }]
            }
        ];

        const contacto_data = {
            name: nombre_completo,
            custom_fields_values: custom_fields
        };

        const contacto_respuesta = await kommo_api.post('/contacts', [contacto_data]);
        const contacto_id = contacto_respuesta.data._embedded.contacts[0].id;
        console.log(`Kommo Budabot - Contacto creado: ${contacto_id}`);

        // 2. Crear la Oportunidad (Lead) vinculada al contacto
        const lead_data = {
            name: `${nombre_completo} - Budabot Onboarding`,
            pipeline_id: BUDABOT_PIPELINE_ID,
            status_id: BUDABOT_STATUS_ID,
            _embedded: {
                contacts: [{
                    id: contacto_id
                }],
                tags: [{ name: 'budabot' }]
            }
        };

        const lead_respuesta = await kommo_api.post('/leads', [lead_data]);
        const lead_id = lead_respuesta.data._embedded.leads[0].id;
        console.log(`Kommo Budabot - Oportunidad creada: ${lead_id}`);

        // 3. Crear una única nota con toda la información del onboarding
        let nota_texto = '📋 DATOS DEL ONBOARDING BUDABOT\n\n';
        nota_texto += '👤 DATOS DE CONTACTO:\n';
        nota_texto += `• Nombre: ${nombre_completo}\n`;
        nota_texto += `• Email: ${email}\n`;
        nota_texto += `• Teléfono: ${telefono}\n`;
        nota_texto += `• Posición: ${posicion}\n`;
        if (sitio_web) {
            nota_texto += `• Sitio Web: ${sitio_web}\n`;
        }
        nota_texto += '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';

        // Agregar las preguntas y respuestas del onboarding
        if (onboarding_respuestas && Array.isArray(onboarding_respuestas) && onboarding_respuestas.length > 0) {
            nota_texto += '💬 RESPUESTAS DEL ONBOARDING:\n\n';
            onboarding_respuestas.forEach((item, index) => {
                nota_texto += `${index + 1}. ${item.question}\n`;
                nota_texto += `   ➜ ${item.answer}\n\n`;
            });
        }

        const nota_data = [{
            entity_id: lead_id,
            note_type: 'common',
            params: {
                text: nota_texto
            }
        }];

        await kommo_api.post(`/leads/${lead_id}/notes`, nota_data);
        console.log(`Kommo Budabot - Nota completa agregada al lead ${lead_id}`);

        res.status(201).json({
            success: true,
            mensaje: 'Contacto y Oportunidad creados exitosamente en Kommo para Budabot.',
            data: {
                contact_id: contacto_id,
                lead_id: lead_id
            }
        });

    } catch (error) {
        console.error('Kommo Budabot - Error:', error.response?.data || error.message);
        res.status(500).json({
            success: false,
            mensaje: 'Error al procesar la solicitud para Budabot.',
            detalles: error.response?.data || error.message
        });
    }
});


// =====================================================
// BREAK TALENT: Endpoints para onboarding de talentos
// =====================================================

// Configuración de Kommo para Break Talent
const KOMMO_TALENT_SUBDOMINIO = process.env.KOMMO_TALENT_SUBDOMINIO
const KOMMO_TALENT_TOKEN = process.env.KOMMO_TALENT_TOKEN
const TALENT_PIPELINE_ID = 12525819
const TALENT_STATUS_ID = 96747831
const TALENT_POSICION_FIELD_ID = 3861268

// Crear instancia de axios para Kommo Talent
function createTalentApi() {
    return axios.create({
        baseURL: `https://${KOMMO_TALENT_SUBDOMINIO}.kommo.com/api/v4`,
        headers: {
            'Authorization': `Bearer ${KOMMO_TALENT_TOKEN}`,
            'Content-Type': 'application/json; charset=utf-8'
        }
    })
}

// TALENT STEP 1: Crear contacto y lead
app.post('/talent/step1', async (req, res) => {
    try {
        const { nombre, telefono, email, linkedin } = req.body

        if (!nombre || !telefono || !email) {
            return res.status(400).json({
                success: false,
                message: 'Campos requeridos: nombre, telefono, email'
            })
        }

        // Validar nombre completo (mínimo 2 palabras)
        const nombreParts = nombre.trim().split(/\s+/)
        if (nombreParts.length < 2) {
            return res.status(400).json({
                success: false,
                message: 'Ingresa tu nombre completo (nombre y apellido)'
            })
        }

        // Validar email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                success: false,
                message: 'Formato de email inválido'
            })
        }

        // Validar LinkedIn (requerido)
        if (!linkedin || !linkedin.startsWith('https://www.linkedin.com/in/')) {
            return res.status(400).json({
                success: false,
                message: 'La URL de LinkedIn es requerida y debe comenzar con https://www.linkedin.com/in/'
            })
        }

        const kommo_api = createTalentApi()

        // Crear el contacto con nombre completo y etiqueta "talento"
        const contactPayload = [{
            name: nombre,
            custom_fields_values: [
                {
                    field_code: 'PHONE',
                    values: [{ value: telefono, enum_code: 'WORK' }]
                },
                {
                    field_code: 'EMAIL',
                    values: [{ value: email, enum_code: 'WORK' }]
                }
            ],
            _embedded: {
                tags: [{ name: 'talento' }]
            }
        }]

        const contactResponse = await kommo_api.post('/contacts', contactPayload)
        const contactId = contactResponse.data._embedded.contacts[0].id
        console.log('Talent - Contacto creado:', contactId)

        // Crear el lead con título "nombre - onboarding" y etiqueta "talento"
        const leadPayload = [{
            name: `${nombre} - onboarding`,
            pipeline_id: TALENT_PIPELINE_ID,
            status_id: TALENT_STATUS_ID,
            _embedded: {
                contacts: [{ id: contactId }],
                tags: [{ name: 'talento' }]
            }
        }]

        const leadResponse = await kommo_api.post('/leads', leadPayload)
        const leadId = leadResponse.data._embedded.leads[0].id
        console.log('Talent - Lead creado:', leadId)

        res.status(201).json({
            success: true,
            message: 'Contacto y lead creados exitosamente',
            data: {
                leadId,
                contactId
            }
        })

    } catch (error) {
        console.error('Talent Step1 - Error:', error.response?.data || error.message)
        res.status(500).json({
            success: false,
            message: 'Error al crear contacto y lead',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        })
    }
})

// TALENT STEP 2: Actualizar con posición y motivación
app.post('/talent/step2', async (req, res) => {
    try {
        const { leadId, contactId, posicion, motivacion } = req.body

        if (!leadId || !posicion || !motivacion) {
            return res.status(400).json({
                success: false,
                message: 'Campos requeridos: leadId, posicion, motivacion'
            })
        }

        const kommo_api = createTalentApi()

        // Actualizar el campo Posición en el lead
        const leadPayload = {
            custom_fields_values: [
                {
                    field_id: TALENT_POSICION_FIELD_ID,
                    values: [{ value: posicion }]
                }
            ]
        }

        await kommo_api.patch(`/leads/${leadId}`, leadPayload)

        // Agregar nota con la pregunta de motivación
        const noteContent = [
            '¿Qué es lo que más te motiva para esta posición?',
            motivacion
        ].join('\n')

        const notePayload = [{
            entity_id: leadId,
            note_type: 'common',
            params: {
                text: noteContent
            }
        }]

        await kommo_api.post('/leads/notes', notePayload)
        console.log('Talent Step2 - Lead actualizado:', leadId)

        res.status(200).json({
            success: true,
            message: 'Lead actualizado con posición y motivación'
        })

    } catch (error) {
        console.error('Talent Step2 - Error:', error.response?.data || error.message)
        res.status(500).json({
            success: false,
            message: 'Error al actualizar lead',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        })
    }
})

// TALENT STEP 3: Agregar notas de pretensión salarial y trabajo por proyecto
app.post('/talent/step3', async (req, res) => {
    try {
        const { leadId, pretension_salarial, trabajo_proyecto } = req.body

        if (!leadId || !pretension_salarial || !trabajo_proyecto) {
            return res.status(400).json({
                success: false,
                message: 'Campos requeridos: leadId, pretension_salarial, trabajo_proyecto'
            })
        }

        const kommo_api = createTalentApi()

        // Nota 1: Pretensión salarial
        const notaSalarial = [
            '¿Cuál es tu pretensión salarial?',
            pretension_salarial
        ].join('\n')

        await kommo_api.post('/leads/notes', [{
            entity_id: leadId,
            note_type: 'common',
            params: { text: notaSalarial }
        }])

        // Nota 2: Trabajo por proyecto/hora
        const trabajoRespuesta = trabajo_proyecto === 'si' ? 'Sí' : 'No'
        const notaTrabajo = [
            '¿Estás dispuesto a trabajar por proyecto/hora?',
            trabajoRespuesta
        ].join('\n')

        await kommo_api.post('/leads/notes', [{
            entity_id: leadId,
            note_type: 'common',
            params: { text: notaTrabajo }
        }])

        console.log('Talent Step3 - Notas agregadas al lead:', leadId)

        res.status(200).json({
            success: true,
            message: 'Lead actualizado con pretensión salarial'
        })

    } catch (error) {
        console.error('Talent Step3 - Error:', error.response?.data || error.message)
        res.status(500).json({
            success: false,
            message: 'Error al actualizar lead',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        })
    }
})

// TALENT STEP 4: Subir CV
app.post('/talent/step4', upload.single('cv'), async (req, res) => {
    try {
        const { leadId } = req.body
        const file = req.file

        if (!leadId) {
            return res.status(400).json({
                success: false,
                message: 'Campo requerido: leadId'
            })
        }

        if (!file) {
            return res.status(400).json({
                success: false,
                message: 'Campo requerido: cv (archivo PDF)'
            })
        }

        // 0. Obtener la URL del drive
        const accountResponse = await axios.get(
            `https://${KOMMO_TALENT_SUBDOMINIO}.kommo.com/api/v4/account?with=drive_url`,
            {
                headers: {
                    'Authorization': `Bearer ${KOMMO_TALENT_TOKEN}`
                }
            }
        )
        const driveUrl = accountResponse.data.drive_url

        // 1. Abrir sesión de carga en el drive
        const sessionResponse = await axios.post(
            `${driveUrl}/v1.0/sessions`,
            {
                file_name: file.originalname,
                file_size: file.buffer.length
            },
            {
                headers: {
                    'Authorization': `Bearer ${KOMMO_TALENT_TOKEN}`,
                    'Content-Type': 'application/json; charset=utf-8'
                }
            }
        )

        const { upload_url, max_part_size } = sessionResponse.data

        // 2. Subir el archivo en partes si es necesario
        let currentUrl = upload_url
        let offset = 0
        let fileData = null

        while (offset < file.buffer.length) {
            const partSize = Math.min(max_part_size, file.buffer.length - offset)
            const part = file.buffer.slice(offset, offset + partSize)

            const uploadResponse = await axios.post(currentUrl, part, {
                headers: {
                    'Content-Type': 'application/octet-stream'
                }
            })

            if (uploadResponse.data.uuid) {
                fileData = uploadResponse.data
            } else if (uploadResponse.data.next_url) {
                currentUrl = uploadResponse.data.next_url
            }

            offset += partSize
        }

        // 3. Adjuntar el archivo al lead
        if (fileData) {
            await axios.put(
                `https://${KOMMO_TALENT_SUBDOMINIO}.kommo.com/api/v4/leads/${leadId}/files`,
                [{ file_uuid: fileData.uuid }],
                {
                    headers: {
                        'Authorization': `Bearer ${KOMMO_TALENT_TOKEN}`,
                        'Content-Type': 'application/json; charset=utf-8'
                    }
                }
            )
        }

        console.log('Talent Step4 - CV subido para lead:', leadId)

        res.status(200).json({
            success: true,
            message: 'CV subido exitosamente'
        })

    } catch (error) {
        console.error('Talent Step4 - Error:', error.response?.data || error.message)
        res.status(500).json({
            success: false,
            message: 'Error al subir CV',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        })
    }
})


// =====================================================
// TIENDA NUBE: OAuth callback y sincronización
// =====================================================

// Callback OAuth de Tienda Nube
app.get('/callback', async (req, res) => {
    const { code } = req.query

    if (!code) {
        return res.status(400).send('Falta el parámetro "code"')
    }

    try {
        const { user_id, access_token } = await exchangeCodeForToken(code)

        saveStore(user_id, access_token)
        console.log(`Tienda Nube - Tienda ${user_id} conectada`)

        res.send(`
            <!DOCTYPE html>
            <html lang="es">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Tienda Conectada</title>
                <style>
                    body { font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f5f5f5; }
                    .card { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); text-align: center; max-width: 500px; }
                    h1 { color: #2ecc71; font-size: 24px; }
                    p { color: #666; }
                    .env-vars { background: #f0f0f0; padding: 15px; border-radius: 8px; text-align: left; font-family: monospace; font-size: 13px; word-break: break-all; margin-top: 20px; }
                    .env-vars strong { display: block; margin-bottom: 5px; color: #333; }
                </style>
            </head>
            <body>
                <div class="card">
                    <h1>Tienda conectada correctamente</h1>
                    <p>Tu tienda (ID: ${user_id}) fue vinculada. Los pedidos se sincronizarán automáticamente cada 4 horas.</p>
                    <div class="env-vars">
                        <strong>Agregar esta tienda a TIENDANUBE_STORES en Render:</strong>
                        {"user_id":"${user_id}","access_token":"${access_token}"}
                    </div>
                </div>
            </body>
            </html>
        `)
    } catch (error) {
        console.error('Tienda Nube - Error OAuth:', error.response?.data || error.message)
        res.status(500).send('Error al conectar la tienda. Intentá nuevamente.')
    }
})

// Forzar sincronización manual
// Uso: /sync (todos los pedidos) o /sync?since=2024-01-01 (desde una fecha)
app.get('/sync', async (req, res) => {
    try {
        const since = req.query.since || null
        await syncAllStores(since)
        res.json({ success: true, mensaje: 'Sincronización completada' })
    } catch (error) {
        console.error('Sync manual - Error:', error.message)
        res.status(500).json({ success: false, mensaje: 'Error en sincronización', detalles: error.message })
    }
})


// =====================================================
// MARLACA: Meta Conversions API (server-side pixel)
// =====================================================
const sha256 = v => crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex')
const normPhone = v => String(v || '').replace(/[^\d]/g, '')

app.post('/marlaca/capi', async (req, res) => {
    try {
        const pixelId = process.env.MARLACA_META_PIXEL_ID
        const token = process.env.MARLACA_META_CAPI_TOKEN
        if (!pixelId || !token) {
            return res.status(500).json({ success: false, mensaje: 'CAPI no configurada' })
        }

        const {
            event_name = 'Lead',
            event_id,
            event_source_url,
            user_data = {},
            custom_data = {}
        } = req.body || {}

        const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress
        const ua = req.headers['user-agent'] || ''

        const hashed = {}
        if (user_data.email) hashed.em = sha256(user_data.email)
        if (user_data.phone) hashed.ph = sha256(normPhone(user_data.phone))
        if (user_data.first_name) hashed.fn = sha256(user_data.first_name)
        if (user_data.last_name) hashed.ln = sha256(user_data.last_name)
        if (user_data.country) hashed.country = sha256(user_data.country)
        if (user_data.fbp) hashed.fbp = user_data.fbp
        if (user_data.fbc) hashed.fbc = user_data.fbc
        if (ip) hashed.client_ip_address = ip
        if (ua) hashed.client_user_agent = ua

        const payload = {
            data: [{
                event_name,
                event_time: Math.floor(Date.now() / 1000),
                event_id,
                event_source_url,
                action_source: 'website',
                user_data: hashed,
                custom_data
            }]
        }

        const r = await axios.post(
            `https://graph.facebook.com/v21.0/${pixelId}/events?access_token=${token}`,
            payload,
            { timeout: 8000 }
        )

        res.json({ success: true, meta: r.data })
    } catch (error) {
        console.error('Marlaca CAPI - Error:', error.response?.data || error.message)
        res.status(500).json({
            success: false,
            mensaje: 'Error enviando evento a Meta',
            detalles: error.response?.data || error.message
        })
    }
})


// =====================================================
// META: Webhook de Lead Ads (formularios instantáneos)
// =====================================================
// GET: handshake de verificación con Meta (hub.challenge)
app.get('/meta/webhook', (req, res) => {
    const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN
    const mode = req.query['hub.mode']
    const token = req.query['hub.verify_token']
    const challenge = req.query['hub.challenge']
    if (mode === 'subscribe' && verifyToken && token === verifyToken) {
        console.log('Meta webhook - verificación OK')
        return res.status(200).send(challenge)
    }
    console.warn('Meta webhook - verificación rechazada', { mode, hasToken: !!token })
    return res.sendStatus(403)
})

// --- Config Marlaca (routing + Kommo) -----------------------------------
// Pipeline: "Generación de demanda" (14547399) · Status: "CONTACTO INICIAL" (112380479)
const MARLACA_KOMMO = {
    base: 'https://marlaca.kommo.com/api/v4',
    token: process.env.MARLACA_KOMMO_TOKEN,
    pipelineId: parseInt(process.env.MARLACA_KOMMO_PIPELINE_ID || '14547399', 10),
    statusId: parseInt(process.env.MARLACA_KOMMO_STATUS_ID || '112380479', 10)
}

const META_PAGE_ROUTING = {
    [process.env.MARLACA_META_PAGE_ID || '']: {
        name: 'marlaca',
        kommo: MARLACA_KOMMO,
        tags: ['Meta Ads']
    }
}

// --- Helpers compartidos (Meta webhook + formulario web) ----------------
// Normaliza un número a solo dígitos para wa.me (sin +, espacios, guiones)
function normalizeIntlPhone(raw) {
    if (!raw) return null
    let n = String(raw).replace(/\D/g, '')
    if (!n) return null
    if (n.startsWith('00')) n = n.slice(2)
    if (n.length < 7 || n.length > 15) return null
    return n
}

function waLink(digits) {
    return `https://wa.me/${digits}`
}

function buildWhatsAppNote(phones) {
    // phones: [{ label, raw }, ...]  → nota con links clickeables
    const valid = (phones || [])
        .map(p => ({ label: p.label, raw: p.raw, digits: normalizeIntlPhone(p.raw) }))
        .filter(p => p.digits)
    if (!valid.length) return null
    const lines = ['Para hablar por WhatsApp, hacé clic en el enlace:', '--']
    for (const p of valid) {
        lines.push(`• ${p.label} (${p.raw}): ${waLink(p.digits)}`)
    }
    lines.push('--')
    return lines.join('\n')
}

async function kommoCreateContact(cfg, { name, email, phone, phoneAlt }) {
    const phoneValues = []
    if (phone) phoneValues.push({ value: phone, enum_code: 'MOB' })
    if (phoneAlt && phoneAlt !== phone) phoneValues.push({ value: phoneAlt, enum_code: 'WORK' })
    const custom = []
    if (phoneValues.length) custom.push({ field_code: 'PHONE', values: phoneValues })
    if (email) custom.push({ field_code: 'EMAIL', values: [{ value: email, enum_code: 'WORK' }] })
    const payload = [{ name: name || 'Sin nombre', custom_fields_values: custom }]
    const r = await axios.post(`${cfg.base}/contacts`, payload, {
        headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json; charset=utf-8' },
        timeout: 10000
    })
    return r.data._embedded.contacts[0].id
}

async function kommoCreateLead(cfg, { name, contactId, tags }) {
    const payload = [{
        name,
        pipeline_id: cfg.pipelineId,
        status_id: cfg.statusId,
        _embedded: {
            contacts: [{ id: contactId }],
            tags: (tags || []).map(t => ({ name: t }))
        }
    }]
    const r = await axios.post(`${cfg.base}/leads`, payload, {
        headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json; charset=utf-8' },
        timeout: 10000
    })
    return r.data._embedded.leads[0].id
}

async function kommoAddNote(cfg, leadId, text) {
    if (!text) return
    await axios.post(`${cfg.base}/leads/${leadId}/notes`, [{
        entity_id: leadId,
        note_type: 'common',
        params: { text }
    }], {
        headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json; charset=utf-8' },
        timeout: 10000
    })
}

// --- Meta Lead Ads (webhook) --------------------------------------------
async function fetchMetaLead(leadgenId) {
    const token = process.env.META_SYSTEM_USER_TOKEN
    const version = process.env.META_GRAPH_VERSION || 'v21.0'
    if (!token) throw new Error('META_SYSTEM_USER_TOKEN no configurado')
    const url = `https://graph.facebook.com/${version}/${leadgenId}?fields=field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,platform,created_time,form_id,form{name}&access_token=${token}`
    const r = await axios.get(url, { timeout: 10000 })
    return r.data
}

function parseMetaLeadFields(fieldData = []) {
    const map = {}
    for (const f of fieldData) {
        if (!f.name) continue
        map[f.name.toLowerCase()] = (f.values && f.values[0]) || ''
    }
    const first = map.first_name || map.nombre || ''
    const last = map.last_name || map.apellido || map.apellidos || ''
    const name = map.full_name || map.nombre_completo || [first, last].filter(Boolean).join(' ').trim() || 'Lead sin nombre'
    const email = map.email || map.correo || ''
    const phone = map.phone_number || map.phone || ''
    // Buscar un segundo teléfono en campos custom (keywords comunes)
    let phoneAlt = ''
    for (const [k, v] of Object.entries(map)) {
        if (k === 'phone_number' || k === 'phone' || !v) continue
        if (/tel[eé]fono|celular|whatsapp|m[oó]vil|n[uú]mero/.test(k)) { phoneAlt = v; break }
    }
    return { name, email, phone, phoneAlt, raw: fieldData }
}

async function processLeadgen(leadgenId, pageId) {
    const route = META_PAGE_ROUTING[pageId]
    if (!route) {
        console.warn(`Meta webhook - page_id ${pageId} sin ruteo configurado, se descarta`)
        return
    }
    const lead = await fetchMetaLead(leadgenId)
    const parsed = parseMetaLeadFields(lead.field_data)
    const cfg = route.kommo

    const contactId = await kommoCreateContact(cfg, {
        name: parsed.name, email: parsed.email, phone: parsed.phone, phoneAlt: parsed.phoneAlt
    })

    const formName = (lead.form && lead.form.name) || lead.form_id || 'Formulario'
    const tags = [...route.tags, formName]
    const leadId = await kommoCreateLead(cfg, {
        name: `Meta Ads - ${formName} - ${parsed.name}`,
        contactId,
        tags
    })

    // Nota 1: respuestas + campaña
    const l1 = ['Lead recibido de Meta Ads (formulario instantáneo)']
    if (lead.form_id) l1.push(`Form ID: ${lead.form_id}`)
    if (lead.campaign_name) l1.push(`Campaña: ${lead.campaign_name}`)
    if (lead.adset_name) l1.push(`Conjunto de anuncios: ${lead.adset_name}`)
    if (lead.ad_name) l1.push(`Anuncio: ${lead.ad_name}`)
    if (lead.platform) l1.push(`Plataforma: ${lead.platform}`)
    if (lead.created_time) l1.push(`Enviado: ${lead.created_time}`)
    l1.push('', 'Respuestas del formulario:')
    for (const f of parsed.raw || []) {
        l1.push(`- ${f.name}: ${(f.values || []).join(', ')}`)
    }
    await kommoAddNote(cfg, leadId, l1.join('\n'))

    // Nota 2: links WhatsApp (si hay teléfono)
    const waNote = buildWhatsAppNote([
        { label: 'Teléfono', raw: parsed.phone },
        { label: 'Teléfono del formulario', raw: parsed.phoneAlt }
    ])
    if (waNote) await kommoAddNote(cfg, leadId, waNote)

    console.log(`Meta webhook - lead procesado (${route.name}): contact=${contactId} lead=${leadId}`)
}

// POST: recibe eventos leadgen. Valida HMAC → responde 200 inmediato → procesa async.
app.post('/meta/webhook', (req, res) => {
    const appSecret = process.env.META_APP_SECRET
    const sig = req.headers['x-hub-signature-256']
    if (appSecret && sig && req.rawBody) {
        const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(req.rawBody).digest('hex')
        if (sig !== expected) {
            console.warn('Meta webhook - firma inválida')
            return res.sendStatus(403)
        }
    }
    res.sendStatus(200)

    const body = req.body || {}
    for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
            if (change.field !== 'leadgen') continue
            const v = change.value || {}
            if (!v.leadgen_id) continue
            processLeadgen(v.leadgen_id, String(entry.id || v.page_id || '')).catch(err => {
                console.error('Meta webhook - error procesando leadgen:', err.response?.data || err.message)
            })
        }
    }
})


// =====================================================
// MARLACA: Formulario web (landing agendar/) → Kommo
// =====================================================
// Body esperado:
// {
//   nombre, email, prefijo (ej "+34"), telefono,
//   opcion?, presupuesto?, horizonte?,            // respuestas del quiz
//   q?: { label: value, ... },                    // respuestas extra (opcional)
//   tracking?: { utm_source, utm_medium, ... },   // UTMs + referer
//   calificacion?, puntaje?, ruta?, alerta?       // scoring del quiz
// }
app.post('/marlaca/form', async (req, res) => {
    try {
        const b = req.body || {}
        const nombre = (b.nombre || '').toString().trim()
        const email = (b.email || '').toString().trim()
        const prefijo = (b.prefijo || '').toString().trim()
        const telefono = (b.telefono || '').toString().trim()
        if (!nombre || !email) {
            return res.status(400).json({ success: false, mensaje: 'nombre y email son obligatorios' })
        }
        const phoneRaw = prefijo && telefono ? `${prefijo} ${telefono}` : (telefono || '')
        const cfg = MARLACA_KOMMO

        // 1. Contacto
        const contactId = await kommoCreateContact(cfg, { name: nombre, email, phone: phoneRaw })

        // 2. Lead
        const ruta = (b.ruta || '').toString().trim()
        const tier = (b.calificacion || '').toString().trim()
        const title = ruta
            ? `WEB - ${ruta} - ${nombre}`
            : `WEB - Marlaca - ${nombre}`
        const tags = ['WEB']
        const leadId = await kommoCreateLead(cfg, { name: title, contactId, tags })

        // 3. Nota con respuestas del quiz + tracking
        const lines = ['Lead recibido del formulario web (agendar/)']
        if (tier || b.puntaje) lines.push(`Scoring: ${tier || '-'} · ${b.puntaje || '-'}`)
        if (ruta) lines.push(`Ruta: ${ruta}`)
        if (b.alerta) lines.push(`Alerta: ${b.alerta}`)
        lines.push('')
        lines.push('Respuestas del formulario:')
        if (b.opcion) lines.push(`- Opción: ${b.opcion}`)
        if (b.presupuesto) lines.push(`- Presupuesto: ${b.presupuesto}`)
        if (b.horizonte) lines.push(`- Horizonte: ${b.horizonte}`)
        if (b.q && typeof b.q === 'object') {
            for (const [k, v] of Object.entries(b.q)) {
                if (v !== undefined && v !== null && v !== '') lines.push(`- ${k}: ${v}`)
            }
        }
        if (b.tracking && typeof b.tracking === 'object') {
            lines.push('', 'Tracking:')
            for (const [k, v] of Object.entries(b.tracking)) {
                if (v !== undefined && v !== null && v !== '') lines.push(`${k}: ${v}`)
            }
        }
        await kommoAddNote(cfg, leadId, lines.join('\n'))

        // 4. Nota WhatsApp (si hay teléfono)
        const waNote = buildWhatsAppNote([{ label: 'Teléfono', raw: phoneRaw }])
        if (waNote) await kommoAddNote(cfg, leadId, waNote)

        console.log(`Marlaca form - contact=${contactId} lead=${leadId}`)
        res.json({ success: true, contact_id: contactId, lead_id: leadId })
    } catch (error) {
        console.error('Marlaca form - error:', error.response?.data || error.message)
        res.status(500).json({
            success: false,
            mensaje: 'Error al procesar el formulario',
            detalles: error.response?.data || error.message
        })
    }
})


// Iniciar servidor
app.listen(PORT, () => {
    startCron()
    console.log(`Servidor corriendo en puerto: ${PORT}`)
    console.log('\nEndpoints Tienda Nube:')
    console.log('  GET  /callback - OAuth callback de Tienda Nube')
    console.log('  GET  /sync     - Forzar sincronización manual')
    console.log('\nEndpoints Budabot:')
    console.log('  POST /budabot - Crear contacto y lead con respuestas del onboarding')
    console.log('\nEndpoints Talent:')
    console.log('  POST /talent/step1 - Crear contacto y lead')
    console.log('  POST /talent/step2 - Posición y motivación')
    console.log('  POST /talent/step3 - Pretensión salarial')
    console.log('  POST /talent/step4 - Subir CV')
    console.log('\nEndpoints Marlaca:')
    console.log('  POST /marlaca/capi - Meta Conversions API (server-side pixel)')
    console.log('  POST /marlaca/form - Formulario web → Kommo (contacto + lead + notas)')
    console.log('\nEndpoints Meta Webhook:')
    console.log('  GET  /meta/webhook - handshake de verificación con Meta')
    console.log('  POST /meta/webhook - recepción de eventos leadgen → Kommo')
})