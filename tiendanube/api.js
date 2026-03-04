const axios = require('axios')
const fs = require('fs')
const path = require('path')

const STORES_FILE = path.join(__dirname, '..', 'data', 'stores.json')

const TIENDANUBE_APP_ID = process.env.TIENDANUBE_APP_ID
const TIENDANUBE_CLIENT_SECRET = process.env.TIENDANUBE_CLIENT_SECRET

// Intercambiar código OAuth por access_token
async function exchangeCodeForToken(code) {
    const response = await axios.post('https://www.tiendanube.com/apps/authorize/token', {
        client_id: TIENDANUBE_APP_ID,
        client_secret: TIENDANUBE_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code
    })

    return {
        user_id: response.data.user_id,
        access_token: response.data.access_token
    }
}

// Obtener pedidos de una tienda (con paginación automática)
async function getOrders(storeId, accessToken, sinceDate) {
    const allOrders = []
    let page = 1

    const headers = {
        'Authentication': `bearer ${accessToken}`,
        'User-Agent': 'Indu API (hola@breakmkt.com.ar)',
        'Content-Type': 'application/json'
    }

    while (true) {
        const params = { per_page: 200, page }

        if (sinceDate) {
            params.created_at_min = sinceDate
        }

        const response = await axios.get(
            `https://api.tiendanube.com/v1/${storeId}/orders`,
            { params, headers }
        )

        const orders = response.data

        if (!orders || orders.length === 0) break

        allOrders.push(...orders)
        console.log(`  Página ${page}: ${orders.length} pedidos (total acumulado: ${allOrders.length})`)

        if (orders.length < 200) break

        page++
    }

    return allOrders
}

// Leer tiendas guardadas (env var tiene prioridad sobre archivo)
// Formato env: TIENDANUBE_STORES=[{"user_id":"123","access_token":"abc"},{"user_id":"456","access_token":"def"}]
function getStores() {
    // Fuente principal: variable de entorno JSON (persiste en Render)
    if (process.env.TIENDANUBE_STORES) {
        try {
            const parsed = JSON.parse(process.env.TIENDANUBE_STORES)
            return parsed.map(s => ({
                user_id: String(s.user_id),
                access_token: s.access_token,
                name: s.name || `Tienda_${s.user_id}`,
                connected_at: null,
                last_sync: null
            }))
        } catch (e) {
            console.error('Error parseando TIENDANUBE_STORES:', e.message)
        }
    }

    // Fallback: archivo local (desarrollo)
    if (!fs.existsSync(STORES_FILE)) {
        return []
    }

    const data = JSON.parse(fs.readFileSync(STORES_FILE, 'utf-8'))
    return data.stores || []
}

// Guardar/actualizar tienda
function saveStore(userId, accessToken) {
    const stores = getStores()

    const existing = stores.find(s => s.user_id === String(userId))

    if (existing) {
        existing.access_token = accessToken
        existing.connected_at = new Date().toISOString()
    } else {
        stores.push({
            user_id: String(userId),
            access_token: accessToken,
            connected_at: new Date().toISOString(),
            last_sync: null
        })
    }

    // Asegurar que existe el directorio
    const dir = path.dirname(STORES_FILE)
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
    }

    fs.writeFileSync(STORES_FILE, JSON.stringify({ stores }, null, 2))
}

// Actualizar fecha de última sincronización
function updateLastSync(userId) {
    const stores = getStores()
    const store = stores.find(s => s.user_id === String(userId))

    if (store) {
        store.last_sync = new Date().toISOString()
        fs.writeFileSync(STORES_FILE, JSON.stringify({ stores }, null, 2))
    }
}

module.exports = {
    exchangeCodeForToken,
    getOrders,
    getStores,
    saveStore,
    updateLastSync
}
