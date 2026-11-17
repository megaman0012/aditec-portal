// Sincronizador en segundo plano — ÚNICO componente que habla con MBA3. Pendiente Fase 3.
//
// - Historia desde SYNC_HISTORIA_DESDE, mes a mes, una vez (meses cerrados no se re-consultan).
// - Mes en curso cada SYNC_MES_ACTUAL_MIN minutos.
// - Escribe caché atómica en data/ (archivo temporal + rename).
// - Respuestas raras repetidas -> se DETIENE, guarda estado en data/estado-sync.json y avisa
//   (posible veto: MBA3 > Servicios de Acceso Externo > IPs).
export {};
