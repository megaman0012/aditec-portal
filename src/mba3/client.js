// Cliente MBA3 — SOLO LECTURA. Implementación en Fase 3.
//
// Contrato:
// - Cola serial GLOBAL: una petición a la vez, pausa >= config.mba3.pausaMs entre peticiones.
// - Login POST /ws2_mba3_serv_/login_servicio {codigo,pwd} -> {jwt}; renovar a los renovarMs
//   o ante "Unauthorized" (reintentar 1 vez).
// - Consulta POST /ws2_mba3_serv_Consultas_Externas_/ (multipart: select, from, where, limit),
//   header Authorization: <jwt> (sin Bearer).
// - Respuesta: array = filas | {"error":"009"} = [] | XML 4D <contents> = error.
// - Prohibido /ws2_mba3_serv_api_/ (escritura).
// - Nunca registrar jwt ni pwd.

export class Mba3Client {
  constructor() {
    throw new Error('Mba3Client: pendiente Fase 3');
  }
}
