const cron = require('node-cron')
const { getStores, getOrders, updateLastSync } = require('./api')
const { writeOrders } = require('./google-sheets')

// Sincronizar pedidos de todas las tiendas
// sinceParam: fecha opcional (ej: "2024-01-01"). Si es null, trae todos los pedidos.
async function syncAllStores(sinceParam) {
    const stores = getStores()

    if (stores.length === 0) {
        console.log('Sync - No hay tiendas conectadas')
        return
    }

    console.log(`Sync - Iniciando sincronización de ${stores.length} tienda(s)`)

    for (const store of stores) {
        try {
            // Prioridad: parámetro manual > last_sync > null (todos los pedidos)
            const sinceDate = sinceParam || store.last_sync || null

            if (sinceDate) {
                console.log(`Sync - Tienda ${store.user_id}: obteniendo pedidos desde ${sinceDate}`)
            } else {
                console.log(`Sync - Tienda ${store.user_id}: obteniendo TODOS los pedidos`)
            }

            const orders = await getOrders(store.user_id, store.access_token, sinceDate)
            const count = await writeOrders(orders, store.name)

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
        syncAllStores(null)
    })

    console.log('Cron - Job programado: cada 4 horas (minuto 0)')
}

module.exports = {
    startCron,
    syncAllStores
}
