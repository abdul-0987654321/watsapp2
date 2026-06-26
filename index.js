'use strict';

const express = require('express');
const axios   = require('axios');
const fs      = require('fs');
const path    = require('path');

// ─── CONFIG ─────────────────────────────────────────────────
const INSTANCE   = 'instance182522';
const TOKEN      = 'gc9oes1x4ww25rrh';
const BASE_URL   = `https://api.ultramsg.com/${INSTANCE}`;
const OWNER_NUMBER = '923371240707';
const PORT         = process.env.PORT || 3000;
const ORDERS_FILE  = path.join(__dirname, 'orders.json');
const SESSION_TTL  = 30 * 60 * 1000;

// ─── MENU ───────────────────────────────────────────────────
const MENU = [
  { id: '1', name: 'Chicken Roast (Full)',  price: 1350, desc: 'Ketchup & Fresh Lemons ke sath' },
  { id: '2', name: 'Chicken Roast (Half)',  price: 700,  desc: 'Ketchup & Fresh Lemons ke sath' },
  { id: '3', name: 'Shami Kabab (12 Pcs)', price: 600,  desc: 'Salad & Raita ke sath' },
  { id: '4', name: 'Chicken Piece',        price: 180,  desc: 'Chest/Leg/Thigh/Wing' },
  { id: '5', name: 'Salad',               price: 20,   desc: '' },
  { id: '6', name: 'Raita',               price: 20,   desc: '' },
  { id: '7', name: 'Kheer',               price: 180,  desc: '' },
  { id: '8', name: 'Zarda',               price: 180,  desc: 'Sweet Rice with Chamcham & Raisins' },
];

// ─── SESSION MANAGER ────────────────────────────────────────
const sessions = new Map();
setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL;
  for (const [id, s] of sessions) {
    if (s.lastSeen < cutoff) sessions.delete(id);
  }
}, 5 * 60 * 1000);

function getSession(id) {
  if (!sessions.has(id)) {
    sessions.set(id, { step: 'idle', cart: [], name: null, address: null, phone: null, lastSeen: Date.now() });
  }
  const s = sessions.get(id);
  s.lastSeen = Date.now();
  return s;
}
function resetSession(id) {
  sessions.set(id, { step: 'idle', cart: [], name: null, address: null, phone: null, lastSeen: Date.now() });
}

// ─── ULTRAMSG API ────────────────────────────────────────────
const api = axios.create({ baseURL: BASE_URL });

// Send plain text
async function sendText(to, message) {
  try {
    const phone = to.replace(/\D/g, '');
    await api.post('/messages/chat', null, {
      params: { token: TOKEN, to: phone, body: message }
    });
    console.log(`✅ sendText → ${to}`);
  } catch (err) {
    console.error('sendText error:', err.response?.data || err.message);
  }
}

// Send buttons (UltraMsg supports up to 3 buttons)
async function sendButtons(to, body, buttons) {
  try {
    const phone = to.replace(/\D/g, '');
    // UltraMsg buttons format
    const btns = buttons.map(b => ({ type: 'reply', reply: { id: b.id, title: b.title } }));
    await api.post('/messages/button', null, {
      params: {
        token: TOKEN,
        to: phone,
        body,
        buttons: JSON.stringify(btns),
      }
    });
    console.log(`✅ sendButtons → ${to}`);
  } catch (err) {
    console.error('sendButtons error — fallback text:', err.response?.data || err.message);
    // Fallback plain text
    const txt = body + '\n\n' + buttons.map((b, i) => `${i + 1}. ${b.title}`).join('\n');
    await sendText(to, txt);
  }
}

// Send list message (UltraMsg)
async function sendList(to, body, buttonText, sections) {
  try {
    const phone = to.replace(/\D/g, '');
    await api.post('/messages/list', null, {
      params: {
        token: TOKEN,
        to: phone,
        body,
        buttonText,
        sections: JSON.stringify(sections),
      }
    });
    console.log(`✅ sendList → ${to}`);
  } catch (err) {
    console.error('sendList error — fallback text:', err.response?.data || err.message);
    await sendMenuText(to);
  }
}

// ─── MENU SENDER ─────────────────────────────────────────────
async function sendMenuText(to) {
  const menuText =
    '🍽️ *Hamara Menu*\n\n' +
    MENU.map(m => `*${m.id}.* ${m.name} — *Rs.${m.price}*${m.desc ? '\n    _' + m.desc + '_' : ''}`).join('\n') +
    '\n\n👆 Item number type karein (jaise: *1* ya *1,3*)';
  await sendText(to, menuText);
}

async function sendMenu(to) {
  const sections = [
    {
      title: '🍗 Chicken Items',
      rows: [
        { title: 'Chicken Roast (Full)', rowId: '1', description: 'Rs.1350 — Ketchup & Lemons ke sath' },
        { title: 'Chicken Roast (Half)', rowId: '2', description: 'Rs.700 — Ketchup & Lemons ke sath' },
        { title: 'Chicken Piece',        rowId: '4', description: 'Rs.180 — Chest/Leg/Thigh/Wing' },
      ]
    },
    {
      title: '🥙 Kabab & Sides',
      rows: [
        { title: 'Shami Kabab (12 Pcs)', rowId: '3', description: 'Rs.600 — Salad & Raita ke sath' },
        { title: 'Salad',                rowId: '5', description: 'Rs.20' },
        { title: 'Raita',               rowId: '6', description: 'Rs.20' },
      ]
    },
    {
      title: '🍮 Desserts',
      rows: [
        { title: 'Kheer',  rowId: '7', description: 'Rs.180' },
        { title: 'Zarda',  rowId: '8', description: 'Rs.180 — Sweet Rice with Chamcham & Raisins' },
      ]
    }
  ];

  await sendList(
    to,
    'Apni pasand ka item chunein 👇',
    '📋 Menu Dekhen',
    sections
  );
}

// ─── CART HELPER ─────────────────────────────────────────────
function buildCartText(cart) {
  let total = 0;
  let text = '🛒 *Aapka Cart:*\n━━━━━━━━━━━━━━━━━\n';
  for (const item of cart) {
    const sub = item.qty * item.price;
    text += `• ${item.qty}x ${item.name} = *Rs.${sub}*\n`;
    total += sub;
  }
  text += `━━━━━━━━━━━━━━━━━\n💰 *Total: Rs.${total}*`;
  return { text, total };
}

// ─── SAVE ORDER ──────────────────────────────────────────────
async function saveOrder(order) {
  let orders = [];
  try { orders = JSON.parse(await fs.promises.readFile(ORDERS_FILE, 'utf-8')); } catch {}
  orders.push(order);
  await fs.promises.writeFile(ORDERS_FILE, JSON.stringify(orders, null, 2));
}

// ─── PROCESS ORDER ───────────────────────────────────────────
async function processOrder(from, session) {
  const { text: cartText, total } = buildCartText(session.cart);
  const order = {
    orderId: 'ORD' + Date.now(),
    customerPhone: from,
    name: session.name,
    address: session.address,
    phone: session.phone,
    items: session.cart,
    total,
    timestamp: new Date().toISOString(),
    status: 'pending',
  };
  await saveOrder(order);
  await sendText(from,
    `🎉 *Order Confirm Ho Gaya!*\n\n🆔 Order ID: *${order.orderId}*\n💰 Total: *Rs.${total}*\n\n⏳ Aapka order jald deliver ho ga.\nShukriya! 🙏`
  );
  const ownerMsg =
    `🔔 *Naya Order!*\n━━━━━━━━━━━━━━━━━\n🆔 ${order.orderId}\n👤 ${order.name}\n📞 ${order.phone}\n📍 ${order.address}\n━━━━━━━━━━━━━━━━━\n` +
    order.items.map(i => `• ${i.qty}x ${i.name} = Rs.${i.qty * i.price}`).join('\n') +
    `\n━━━━━━━━━━━━━━━━━\n💰 *Total: Rs.${total}*\n🕐 ${new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}`;
  await sendText(OWNER_NUMBER, ownerMsg);
  console.log(`✅ Order saved — ${order.orderId}`);
  resetSession(from);
}

// ─── MESSAGE HANDLER ─────────────────────────────────────────
async function handleMessage(from, body) {
  const session = getSession(from);
  const text    = (body || '').trim();
  const lower   = text.toLowerCase();

  // START
  if (/^(hi|hello|salam|assalam|start|menu|order)$/i.test(lower)) {
    resetSession(from);
    getSession(from).step = 'browsing';
    await sendText(from, `Assalam-o-Alaikum! 👋 *Khush Amdeed!*\n\nHamara menu dekh rahe hain...`);
    await sendMenu(from);
    return;
  }

  // CANCEL
  if (/^cancel$/i.test(lower)) {
    resetSession(from);
    await sendText(from, '❌ *Order cancel ho gaya.*\nDobara order ke liye *menu* likhein. 😊');
    return;
  }

  // BROWSING
  if (session.step === 'browsing') {
    const ids   = text.split(',').map(s => s.trim());
    const valid = ids.map(id => MENU.find(m => m.id === id)).filter(Boolean);
    if (!valid.length) {
      await sendText(from, '❓ Item nahi mila.\n\nMenu dekhne ke liye *menu* likhein ya number type karein (jaise: *1* ya *1,3*)');
      return;
    }
    for (const item of valid) {
      const ex = session.cart.find(c => c.id === item.id);
      if (ex) ex.qty++;
      else session.cart.push({ ...item, qty: 1 });
    }
    session.step = 'confirm_more';
    const { text: cartText } = buildCartText(session.cart);
    await sendText(from, cartText);
    await sendButtons(from,
      '📌 Aur kuch add karna hai?',
      [
        { id: '1', title: '✅ Checkout' },
        { id: '2', title: '➕ Aur Add Karein' },
        { id: '3', title: '❌ Cancel' },
      ]
    );
    return;
  }

  // CONFIRM MORE
  if (session.step === 'confirm_more') {
    if (/checkout|done|confirm|^1$/i.test(lower)) {
      session.step = 'ask_name';
      await sendText(from, '👤 Apna *naam* bhejein:');
      return;
    }
    if (/aur|add|➕|^2$/i.test(lower)) {
      session.step = 'browsing';
      await sendMenu(from);
      return;
    }
    if (/cancel|❌|^3$/i.test(lower)) {
      resetSession(from);
      await sendText(from, '❌ *Order cancel ho gaya.*\nDobara order ke liye *menu* likhein. 😊');
      return;
    }
    // Maybe adding more items by number
    const ids   = text.split(',').map(s => s.trim());
    const valid = ids.map(id => MENU.find(m => m.id === id)).filter(Boolean);
    if (valid.length) {
      for (const item of valid) {
        const ex = session.cart.find(c => c.id === item.id);
        if (ex) ex.qty++;
        else session.cart.push({ ...item, qty: 1 });
      }
      const { text: cartText } = buildCartText(session.cart);
      await sendText(from, cartText);
      await sendButtons(from, '📌 Aur kuch?', [
        { id: '1', title: '✅ Checkout' },
        { id: '2', title: '➕ Aur Add Karein' },
        { id: '3', title: '❌ Cancel' },
      ]);
    } else {
      await sendButtons(from, '📌 Kya karna hai?', [
        { id: '1', title: '✅ Checkout' },
        { id: '2', title: '➕ Aur Add Karein' },
        { id: '3', title: '❌ Cancel' },
      ]);
    }
    return;
  }

  // ASK NAME
  if (session.step === 'ask_name') {
    if (text.length < 2) { await sendText(from, '⚠️ Sahi *naam* likhein please.'); return; }
    session.name = text;
    session.step = 'ask_address';
    await sendText(from, '📍 Delivery *address* bhejein:\n(Gali, Muhalla, City)');
    return;
  }

  // ASK ADDRESS
  if (session.step === 'ask_address') {
    if (text.length < 5) { await sendText(from, '⚠️ Thoda detail mein *address* likhein.'); return; }
    session.address = text;
    session.step    = 'ask_phone';
    await sendText(from, '📞 Apna *contact number* bhejein:');
    return;
  }

  // ASK PHONE
  if (session.step === 'ask_phone') {
    if (!/^[0-9+\s\-]{10,15}$/.test(text)) {
      await sendText(from, '⚠️ Sahi *phone number* bhejein\n(Jaise: 03001234567)');
      return;
    }
    session.phone = text;
    session.step  = 'final_confirm';
    const { text: cartText, total } = buildCartText(session.cart);
    await sendText(from,
      `📋 *Order Summary*\n\n${cartText}\n\n` +
      `👤 Naam:    *${session.name}*\n` +
      `📍 Address: *${session.address}*\n` +
      `📞 Phone:   *${session.phone}*\n\n` +
      `━━━━━━━━━━━━━━━━━`
    );
    await sendButtons(from,
      `✅ Order Confirm karein?\nTotal: Rs.${total}`,
      [
        { id: '1', title: '✅ Confirm Order!' },
        { id: '2', title: '❌ Cancel Order' },
      ]
    );
    return;
  }

  // FINAL CONFIRM
  if (session.step === 'final_confirm') {
    if (/confirm|yes|haan|ji|ok|^1$|✅/i.test(lower)) {
      await processOrder(from, session);
    } else if (/cancel|no|nahi|^2$|❌/i.test(lower)) {
      resetSession(from);
      await sendText(from, '❌ *Order cancel ho gaya.*\nDobara order ke liye *menu* likhein. 😊');
    } else {
      await sendButtons(from, '✅ Confirm karein?', [
        { id: '1', title: '✅ Confirm Order!' },
        { id: '2', title: '❌ Cancel Order' },
      ]);
    }
    return;
  }

  // DEFAULT
  await sendText(from, 'Assalam-o-Alaikum! 👋\nOrder karne ke liye *menu* likhein. 😊');
}

// ─── EXPRESS ─────────────────────────────────────────────────
const app = express();
app.use(express.json());

app.get('/', (req, res) => res.json({ status: 'ok', sessions: sessions.size, uptime: process.uptime() }));

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const body = req.body;
    console.log('\n📨 Webhook received:', JSON.stringify(body).slice(0, 300));

    // UltraMsg webhook format
    const data = body?.data;
    if (!data) return;

    // Skip outgoing messages
    if (data.fromMe) return;

    // Skip groups
    const from = data.from || '';
    if (from.includes('@g.us') || from.includes('-')) return;

    // Get phone number (UltraMsg sends as 923xxxxxxxxx@c.us or just number)
    const phone = from.replace('@c.us', '').replace(/\D/g, '');
    if (!phone) return;

    // Get message text
    let text = '';
    if (data.type === 'chat') {
      text = data.body || '';
    } else if (data.type === 'list_reply') {
      text = data.listReply?.rowId || data.body || '';
    } else if (data.type === 'button_reply') {
      text = data.buttonReply?.id || data.body || '';
    } else {
      console.log('⚠️ Unknown type:', data.type);
      return;
    }

    if (!text) return;

    console.log(`📩 From: ${phone} | Text: "${text}"`);
    await handleMessage(phone, text);

  } catch (err) {
    console.error('Webhook error:', err);
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Bot running on port ${PORT}`);
});
