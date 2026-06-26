'use strict';

const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ─── CONFIG ─────────────────────────────────────────────
const WHAPI_TOKEN = 'xL2fn7ihaLWC9VpX8B4GwPkSEFFyrrQy';
const WHAPI_URL = 'https://gate.whapi.cloud';
const OWNER_NUMBER = '923371240707';
const PORT = process.env.PORT || 3000;
const ORDERS_FILE = path.join(__dirname, 'orders.json');

// ─── MENU ───────────────────────────────────────────────
const MENU = [
  { id: '1', name: 'Chicken Roast (Full)', price: 1350 },
  { id: '2', name: 'Chicken Roast (Half)', price: 700 },
  { id: '3', name: 'Shami Kabab (12 Pcs)', price: 600 },
  { id: '4', name: 'Chicken Piece', price: 180 },
  { id: '5', name: 'Salad', price: 20 },
  { id: '6', name: 'Raita', price: 20 }
];

// ─── SESSION ────────────────────────────────────────────
const sessions = new Map();

function getSession(id) {
  if (!sessions.has(id)) {
    sessions.set(id, { step: 'idle', cart: [], name: null, address: null, phone: null });
  }
  return sessions.get(id);
}

function resetSession(id) {
  sessions.set(id, { step: 'idle', cart: [], name: null, address: null, phone: null });
}

// ─── WHAPI API ──────────────────────────────────────────
const api = axios.create({
  baseURL: WHAPI_URL,
  headers: {
    'Authorization': `Bearer ${WHAPI_TOKEN}`,
    'Content-Type': 'application/json'
  }
});

// ─── SEND TEXT ──────────────────────────────────────────
async function sendText(to, message) {
  try {
    await api.post('/messages/text', { to, body: message });
    console.log('✅ Text sent to', to);
  } catch (err) {
    console.error('❌ Send Text Error:', err.response?.data || err.message);
  }
}

// ─── SEND BUTTONS ───────────────────────────────────────
// WHAPI correct format: buttons array with type+reply inside
async function sendButtons(to, bodyText, buttons) {
  try {
    const payload = {
      to,
      type: 'button',
      body: { text: bodyText },
      action: {
        buttons: buttons.map(btn => ({
          type: 'reply',
          reply: {
            id: btn.id,
            title: btn.title.substring(0, 20)
          }
        }))
      }
    };
    await api.post('/messages/interactive', payload);
    console.log('✅ Buttons sent');
  } catch (err) {
    console.error('❌ Buttons Error:', err.response?.data || err.message);
    // Fallback: plain text
    let text = `${bodyText}\n\n`;
    buttons.forEach((btn, i) => { text += `${i + 1}. ${btn.title}\n`; });
    text += '\nNumber reply karen.';
    await sendText(to, text);
  }
}

// ─── SEND LIST MESSAGE ──────────────────────────────────
async function sendList(to, bodyText, buttonLabel, rows) {
  try {
    const payload = {
      to,
      type: 'list',
      body: { text: bodyText },
      action: {
        button: buttonLabel,
        sections: [{
          title: 'Menu',
          rows: rows.map(r => ({
            id: r.id,
            title: r.title.substring(0, 24),
            description: (r.description || '').substring(0, 72)
          }))
        }]
      }
    };
    await api.post('/messages/interactive', payload);
    console.log('✅ List sent');
  } catch (err) {
    console.error('❌ List Error:', err.response?.data || err.message);
    // Fallback: plain text
    let text = `${bodyText}\n\n`;
    rows.forEach(r => { text += `${r.id}. ${r.title} — ${r.description}\n`; });
    text += '\nNumber reply karen.';
    await sendText(to, text);
  }
}

async function sendMenuList(to) {
  await sendList(
    to,
    '🍽 *Hamara Menu*\nNeeche button dabayein aur item choose karen:',
    '📋 Menu Kholein',
    MENU.map(item => ({
      id: item.id,
      title: item.name,
      description: `Rs. ${item.price}`
    }))
  );
}

// ─── CART ───────────────────────────────────────────────
function cartText(cart) {
  let total = 0;
  let text = '🛒 *AAPKA CART:*\n';
  for (const i of cart) {
    const sub = i.qty * i.price;
    total += sub;
    text += `  ${i.qty}x ${i.name} = Rs.${sub}\n`;
  }
  text += `\n💰 *Total: Rs.${total}*`;
  return { text, total };
}

// ─── ORDER ──────────────────────────────────────────────
async function saveOrder(order) {
  let data = [];
  try { data = JSON.parse(await fs.promises.readFile(ORDERS_FILE, 'utf8')); } catch {}
  data.push(order);
  await fs.promises.writeFile(ORDERS_FILE, JSON.stringify(data, null, 2));
}

async function processOrder(from, session) {
  const { text, total } = cartText(session.cart);
  const order = {
    id: 'ORD' + Date.now(),
    from,
    name: session.name,
    address: session.address,
    phone: session.phone,
    items: session.cart,
    total,
    time: new Date().toISOString()
  };
  await saveOrder(order);
  await sendText(from,
    `✅ *ORDER CONFIRM HO GAYA!*\n\nOrder ID: ${order.id}\nTotal: Rs.${total}\n\nJald deliver karenge! 🛵`
  );
  await sendText(OWNER_NUMBER,
    `📦 *NAYA ORDER*\n\nID: ${order.id}\nNaam: ${order.name}\nPhone: ${order.phone}\nAddress: ${order.address}\n\n${text}`
  );
  resetSession(from);
}

// ─── MESSAGE HANDLER ────────────────────────────────────
async function handleMessage(from, text) {
  const session = getSession(from);
  const msg = text.toLowerCase().trim();

  console.log(`📩 [${from}] "${text}" | step: ${session.step}`);

  // Global: cancel
  if (msg === 'cancel') {
    resetSession(from);
    await sendText(from, "❌ Order cancel.\n\n'menu' likh kar dobara shuru karen.");
    return;
  }

  // Global: start/menu/hi triggers
  if (/^(menu|start|hi|hello|salam|order|assalam|helo|hey)/.test(msg)) {
    resetSession(from);
    const s = getSession(from);
    s.step = 'main';
    await sendText(from, '👋 *Restaurant mein khush amdeed!*\nAap ka order lene ke liye hum tayar hain. 😊');
    await sendButtons(from, 'Kya karna chahte hain?', [
      { id: 'view_menu', title: '📋 Menu Dekhen' },
      { id: 'view_cart', title: '🛒 Cart Dekhen' },
      { id: 'get_help',  title: '❓ Help' }
    ]);
    return;
  }

  // ── STEP: main ──
  if (session.step === 'main') {
    if (text === 'view_menu' || msg.includes('menu')) {
      session.step = 'browsing';
      await sendMenuList(from);
      return;
    }
    if (text === 'view_cart' || msg.includes('cart')) {
      if (session.cart.length === 0) {
        await sendText(from, '🛒 Cart khali hai!');
        await sendButtons(from, 'Kya karen?', [
          { id: 'view_menu', title: '📋 Menu Dekhen' },
          { id: 'get_help',  title: '❓ Help' }
        ]);
      } else {
        const { text: ct } = cartText(session.cart);
        await sendText(from, ct);
        await sendButtons(from, 'Aage kya karen?', [
          { id: 'add_more', title: '➕ Aur Items' },
          { id: 'checkout', title: '✅ Checkout' },
          { id: 'cancel',   title: '❌ Cancel' }
        ]);
        session.step = 'cart';
      }
      return;
    }
    if (text === 'get_help' || msg.includes('help')) {
      await sendText(from,
        '📖 *Commands:*\n• menu — Menu dekhen\n• cart — Cart dekhen\n• cancel — Cancel karen'
      );
      return;
    }
    // Unknown input at main step
    await sendButtons(from, 'Kya karna chahte hain?', [
      { id: 'view_menu', title: '📋 Menu Dekhen' },
      { id: 'view_cart', title: '🛒 Cart Dekhen' },
      { id: 'get_help',  title: '❓ Help' }
    ]);
    return;
  }

  // ── STEP: browsing ──
  if (session.step === 'browsing') {
    const item = MENU.find(m => m.id === text.trim());
    if (item) {
      const ex = session.cart.find(c => c.id === item.id);
      if (ex) {
        ex.qty++;
        await sendText(from, `✅ ${item.name} dobara add! (${ex.qty}x)`);
      } else {
        session.cart.push({ ...item, qty: 1 });
        await sendText(from, `✅ *${item.name}* cart mein add ho gaya!`);
      }
      const { text: ct } = cartText(session.cart);
      await sendText(from, ct);
      await sendButtons(from, 'Aage kya karen?', [
        { id: 'add_more', title: '➕ Aur Items' },
        { id: 'checkout', title: '✅ Checkout' },
        { id: 'cancel',   title: '❌ Cancel' }
      ]);
      session.step = 'cart';
      return;
    }
    await sendText(from, '⚠️ Menu se item choose karen.');
    await sendMenuList(from);
    return;
  }

  // ── STEP: cart ──
  if (session.step === 'cart') {
    if (text === 'checkout' || msg.includes('checkout')) {
      session.step = 'name';
      await sendText(from, '👤 Apna *naam* likhein:');
      return;
    }
    if (text === 'add_more' || msg.includes('aur') || msg.includes('more')) {
      session.step = 'browsing';
      await sendMenuList(from);
      return;
    }
    if (text === 'cancel' || msg.includes('cancel')) {
      resetSession(from);
      await sendText(from, "❌ Order cancel.\n\n'menu' likh kar dobara shuru karen.");
      return;
    }
    await sendButtons(from, 'Aage kya karen?', [
      { id: 'add_more', title: '➕ Aur Items' },
      { id: 'checkout', title: '✅ Checkout' },
      { id: 'cancel',   title: '❌ Cancel' }
    ]);
    return;
  }

  // ── STEP: name ──
  if (session.step === 'name') {
    session.name = text.trim();
    session.step = 'address';
    await sendText(from, '📍 Delivery *address* likhein:');
    return;
  }

  // ── STEP: address ──
  if (session.step === 'address') {
    session.address = text.trim();
    session.step = 'phone';
    await sendText(from, '📞 Apna *phone number* likhein:');
    return;
  }

  // ── STEP: phone ──
  if (session.step === 'phone') {
    session.phone = text.trim();
    session.step = 'confirm';
    const { text: ct } = cartText(session.cart);
    await sendText(from,
      `📋 *ORDER SUMMARY*\n\n${ct}\n\n👤 Naam: ${session.name}\n📍 Address: ${session.address}\n📞 Phone: ${session.phone}`
    );
    await sendButtons(from, 'Order confirm karen?', [
      { id: 'yes', title: '✅ Confirm' },
      { id: 'no',  title: '❌ Cancel' }
    ]);
    return;
  }

  // ── STEP: confirm ──
  if (session.step === 'confirm') {
    if (text === 'yes' || msg.includes('confirm') || msg === 'yes' || msg === 'ha') {
      await processOrder(from, session);
      return;
    }
    resetSession(from);
    await sendText(from, "❌ Order cancel.\n\n'menu' likh kar dobara shuru karen.");
    return;
  }

  // ── DEFAULT ──
  await sendText(from, "❓ Samajh nahi aaya.\n\n'menu' likh kar shuru karen.");
}

// ─── EXPRESS ─────────────────────────────────────────────
const app = express();
app.use(express.json());

app.get('/', (_, res) => res.json({ status: 'ok', name: 'WhatsApp Food Bot', sessions: sessions.size, uptime: process.uptime() }));

app.get('/webhook', (req, res) => {
  if (req.query.hub_challenge) return res.send(req.query.hub_challenge);
  res.sendStatus(200);
});

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const data = req.body;
    let from = null, text = null;

    if (data.messages?.length > 0) {
      const msg = data.messages[0];

      // ── IGNORE outgoing messages (bot ka apna message) ──
      if (msg.from_me === true) {
        console.log('⏭ Skipping outgoing message');
        return;
      }

      from = msg.from || msg.chat_id?.split('@')[0];
      // Remove WhatsApp suffix if present
      if (from) from = from.replace(/@.*$/, '');

      // Text
      if (msg.text?.body) text = msg.text.body;
      else if (typeof msg.text === 'string') text = msg.text;

      // Interactive reply — use ID for buttons, ID for list
      if (msg.interactive?.button_reply) {
        text = msg.interactive.button_reply.id;
      } else if (msg.interactive?.list_reply) {
        text = msg.interactive.list_reply.id;
      }

      if (!text) text = msg.body || '';
    }

    if (!from) from = data.from || data.sender?.phone;
    if (!text) text = data.text || data.body || '';

    // Clean up
    from = from?.toString().trim();
    text = text?.toString().trim();

    console.log(`👤 From: ${from} | 💬 Text: ${text}`);

    if (from && text) {
      await handleMessage(from, text);
    } else {
      console.log('⏭ Skipping — missing from or text');
    }

  } catch (err) {
    console.error('❌ Webhook Error:', err);
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Bot running on port ${PORT}`);
});
