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

// Obtener pedidos de una tienda
async function getOrders(storeId, accessToken, sinceDate) {
    const params = {
        per_page: 200
    }

    if (sinceDate) {
        params.created_at_min = sinceDate
    }

    const response = await axios.get(
        `https://api.tiendanube.com/v1/${storeId}/orders`,
        {
            params,
            headers: {
                'Authentication': `bearer ${accessToken}`,
                'User-Agent': 'Indu API (hola@breakmkt.com.ar)',
                'Content-Type': 'application/json'
            }
        }
    )

    return response.data
}

// Leer tiendas guardadas (env vars tienen prioridad sobre archivo)
function getStores() {
    const stores = []

    // Fuente principal: variables de entorno (persiste en Render)
    if (process.env.TIENDANUBE_USER_ID && process.env.TIENDANUBE_ACCESS_TOKEN) {
        stores.push({
            user_id: process.env.TIENDANUBE_USER_ID,
            access_token: process.env.TIENDANUBE_ACCESS_TOKEN,
            connected_at: null,
            last_sync: null
        })
        return stores
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
