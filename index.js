require('dotenv').config()
const express = require('express')
const cors = require('cors')
const axios = require('axios')
const app = express()
const PORT = process.env.PORT || 3000

// Middleware
app.use(cors({
    origin: function (origin, callback) {
        const dominios_permitidos = [
            'https://huapi.com.ar',
            'https://www.huapi.com.ar',
            'https://tannery.com.ar',
            'https://www.tannery.com.ar',
            'https://pazcel.com.ar',
            'https://www.pazcel.com.ar',
            'https://breakmkt.com.ar',
            'https://breakmkt.com.ar/preston/'
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
    const kommo_preston_pipeline_id = 12339992
    const kommo_preston_pipeline_etapa_id = 95362684

    try {
        const { nombre_completo, email, telefono, categoria, dni } = req.body

        if (!nombre_completo || !telefono || !categoria) {
            return res.status(400).json({
                success: false,
                mensaje: 'Faltan datos obligatorios: nombre_completo, telefono, categoria'
            })
        }

        let dni_normalizado = null;
        if (dni) {
            dni_normalizado = dni.replace(/[^0-9]/g, '');
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
            custom_fields_values: [
                {
                    field_code: 'PHONE',
                    values: [{
                        enum_code: 'WORK',
                        value: telefono
                    }]
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
                contacts: [{
                    id: contacto_id
                }]
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

// Pazcel: Ruta para manejar la respuestas del formulario webconst nodemailer = require('nodemailer') 
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


// Iniciar servidor
app.listen(PORT, () => {
    console.log(`Servidor corriendo en perto: ${PORT}`)
})