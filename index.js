require('dotenv').config()
const express = require('express')
const cors = require('cors')
const axios = require('axios')
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
            'https://www.talent.breakmkt.com.ar'
        ]

        if (!origin || dominios_permitidos.indexOf(origin) !== -1) {
            callback(null, true)
        } else {
            callback(new Error('CORS'))
        }
    },
    credentials: true
}))
app.use(express.json())

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
                'Content-Type': 'application/json'
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

    const kommo_preston_pipeline_etapa_id = 68359371  // Etapa "INGRESO" — el Salesbot mueve a PREGUNTAR

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
                'Content-Type': 'application/json'
            }
        })

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
                'Content-Type': 'application/json'
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
                'Content-Type': 'application/json'
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
            'Content-Type': 'application/json'
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
                    'Content-Type': 'application/json'
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
                        'Content-Type': 'application/json'
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
})