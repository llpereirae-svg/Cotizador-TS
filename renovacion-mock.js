/* Adaptador de demostración: no envía datos ni se conecta a ningún servicio. */
export const demoRenewalAdapter = {
  finish() { window.location.assign('https://tbc.tributasoft.ec/Erp-web/templates/registro/login.xhtml'); },
  async requestEmailCode() {
    return { status: "simulado", solicitudReferencia: "solicitud-de-ejemplo", message: "Código de ejemplo generado en esta vista." };
  },
  async verifyEmailCode(code) {
    const valid = code === "123456";
    return { valid, status: "simulado", verificacionReferencia: valid ? "verificacion-de-ejemplo" : null };
  },
  async submitRenewal(renewal) {
    return { status: "simulado", accepted: Boolean(renewal), message: "Ningún dato fue enviado." };
  }
};
