/* db.js — LUXE SHOP | API client */
const API = {
  base: '',

  async post(path, data) {
    const r = await fetch(this.base + path, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(data)
    });
    return r.json();
  },

  async get(path) {
    const r = await fetch(this.base + path);
    return r.json();
  },

  async put(path, data) {
    const r = await fetch(this.base + path, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(data)
    });
    return r.json();
  },

  // ── Convenience wrappers ──────────────────────────────────
  login:       (email, pw)     => API.post('/api/login',    { email, password: pw }),
  register:    (name, e, pw)   => API.post('/api/register', { name, email: e, password: pw }),
  getProducts: ()              => API.get('/api/products'),
  getUser:     (uid)           => API.get(`/api/user/${uid}`),
  getCards:    (uid)           => API.get(`/api/cards/${uid}`),
  addCard:     (uid, card)     => API.post('/api/cards', { user_id: uid, ...card }),
  setPin:      (cid, uid, pin) => API.post(`/api/cards/${cid}/set-pin`,    { user_id: uid, pin }),
  verifyPin:   (cid, uid, pin) => API.post(`/api/cards/${cid}/verify-pin`, { user_id: uid, pin }),
  checkout:    (payload)       => API.post('/api/checkout', payload),
  getOrders:   (uid)           => API.get(`/api/orders/${uid}`),
  getTxns:     (uid)           => API.get(`/api/transactions/${uid}`),
  getTiers:    ()              => API.get('/api/tiers'),
  calcEmi:     (amt, mo)       => API.post('/api/emi/calculate', { amount: amt, months: mo }),
};
