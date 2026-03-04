const cron = require('node-cron')
const { getStores, getOrders, updateLastSync } = require('./api')
const { writeOrders } = require('./google-sheets')

// Sincronizar pedidos de todas las tiendas
async function syncAllStores() {
    const stores = getStores()

    if (stores.length === 0) {
        console.log('Sync - No hay tiendas conectadas')
        return
    }

    console.log(`Sync - Iniciando sincronización de ${stores.length} tienda(s)`)

    for (const store of stores) {
        try {
            // Usar last_sync o últimas 4 horas como fallback
            const sinceDate = store.last_sync || new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()

            console.log(`Sync - Tienda ${store.user_id}: obteniendo pedidos desde ${sinceDate}`)

            const orders = await getOrders(store.user_id, store.access_token, sinceDate)
            const count = await writeOrders(orders, store.user_id)

            updateLastSync(store.user_id)
            console.log(`Sync - Tienda ${store.user_id}: ${count} pedidos sincronizados`)

        } catch (error) {
            console.error(`Sync - Error en tienda ${store.user_id}:`, error.response?.data || error.message)
        }
    }

    console.log('Sync - Sincronización completada')
}

// Iniciar cron job cada 4 horas
function startCron() {
    cron.schedule('0 */4 * * *', () => {
        console.log(`Cron - Ejecutando sincronización: ${new Date().toISOString()}`)
        syncAllStores()
    })

    console.log('Cron - Job programado: cada 4 horas (minuto 0)')
}

module.exports = {
    startCron,
    syncAllStores
}
