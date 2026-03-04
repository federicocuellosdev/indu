const { google } = require('googleapis')

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID

let sheetsClient = null

// Inicializar cliente de Google Sheets con credenciales desde .env
async function getClient() {
    if (sheetsClient) return sheetsClient

    const auth = new google.auth.GoogleAuth({
        credentials: {
            client_email: process.env.GOOGLE_CLIENT_EMAIL,
            private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
        },
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    })

    sheetsClient = google.sheets({ version: 'v4', auth })
    return sheetsClient
}

// Escribir pedidos en Google Sheets
async function writeOrders(orders, storeId) {
    if (!orders || orders.length === 0) {
        console.log(`Google Sheets - Sin pedidos nuevos para tienda ${storeId}`)
        return 0
    }

    const sheets = await getClient()
    const sheetName = `Tienda_${storeId}`

    // Verificar si la hoja existe, si no crearla
    await ensureSheet(sheets, sheetName)

    // Headers
    const headers = [
        'ID Pedido', 'Numero', 'Fecha', 'Estado',
        'Cliente', 'Email', 'Telefono',
        'Total', 'Moneda', 'Productos',
        'Estado Pago', 'Estado Envio'
    ]

    // Mapear pedidos a filas
    const rows = orders.map(order => {
        const productos = (order.products || [])
            .map(p => `${p.name} x${p.quantity}`)
            .join(', ')

        return [
            order.id,
            order.number,
            order.created_at,
            order.status,
            order.customer ? `${order.customer.name}` : '',
            order.customer ? order.customer.email : '',
            order.customer ? order.customer.phone : '',
            order.total,
            order.currency,
            productos,
            order.payment_status,
            order.shipping_status
        ]
    })

    // Limpiar hoja y escribir headers + datos
    await sheets.spreadsheets.values.clear({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetName}!A:L`
    })

    await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetName}!A1`,
        valueInputOption: 'RAW',
        requestBody: {
            values: [headers, ...rows]
        }
    })

    console.log(`Google Sheets - ${rows.length} pedidos escritos en hoja "${sheetName}"`)
    return rows.length
}

// Asegurar que la hoja existe en el spreadsheet
async function ensureSheet(sheets, sheetName) {
    const spreadsheet = await sheets.spreadsheets.get({
        spreadsheetId: SPREADSHEET_ID
    })

    const exists = spreadsheet.data.sheets.some(
        s => s.properties.title === sheetName
    )

    if (!exists) {
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            requestBody: {
                requests: [{
                    addSheet: {
                        properties: { title: sheetName }
                    }
                }]
            }
        })
        console.log(`Google Sheets - Hoja "${sheetName}" creada`)
    }
}

module.exports = {
    writeOrders
}
