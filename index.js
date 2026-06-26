'use strict';

const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ─── CONFIG ─────────────────────────────────────────────
const WHAPI_TOKEN = 'xL2fn7ihaLWC9VpX8B4GwPkSEFFyrrQy';
const WHAPI_URL = 'https://gate.whapi.cloud/';
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
    console.log('✅ Text sent');
  } catch (err) {
    console.error('❌ Send Text Error:', err.response?.data || err.message);
  }
}

// ─── SEND BUTTONS (max 3, title max 20 chars) ───────────
// buttons = array of { id, title } objects
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
            title: btn.title.substring(0, 20) // WhatsApp hard limit
          }
        }))
      }
    };
    await api.post('/messages/interactive', payload);
    console.log('✅ Buttons sent');
  } catch (err) {
    console.error('❌ Buttons Error:', err.response?.data || err.message);
    // Fallback to text
    let text = `${bodyText}\n\n`;
    buttons.forEach(btn => { text += `▪ ${btn.title}\n`; });
    await sendText(to, text);
  }
}

// ─── SEND LIST MESSAGE (supports up to 10 items) ────────
async function sendList(to, bodyText, buttonTitle, rows) {
  try {
    const payload = {
      to,
      type: 'list',
      body: { text: bodyText },
      action: {
        button: buttonTitle, // button that opens the list
        sections: [
          {
            title: '🍽 Menu Items',
            rows: rows.map(r => ({
              id: r.id,
              title: r.title.substring(0, 24),       // WhatsApp limit
              description: r.description?.substring(0, 72) || '' // WhatsApp limit
            }))
          }
        ]
      }
    };
    await api.post('/messages/interactive', payload);
    console.log('✅ List sent');
  } catch (err) {
    console.error('❌ List Error:', err.response?.data || err.message);
    // Fallback to numbered text
    let text = `${bodyText}\n\n`;
    rows.forEach(r => { text += `${r.id}. ${r.title} - ${r.description}\n`; });
    text += '\nReply with item number to add.';
    await sendText(to, text);
  }
}

// ─── SEND MENU AS LIST ──────────────────────────────────
async function sendMenuList(to) {
  const rows = MENU.map(item => ({
    id: item.id,
    title: item.name,
    description: `Rs. ${item.price}`
  }));

  await sendList(
    to,
    '🍽 *Our Menu*\nTap the button below to see all items and select one:',
    '📋 Open Menu',
    rows
  );
}

// ─── CART TEXT ──────────────────────────────────────────
function cartText(cart) {
  let total = 0;
  let text = '🛒 *YOUR CART:*\n';
  for (const i of cart) {
    const sub = i.qty * i.price;
    total += sub;
    text += `  ${i.qty}x ${i.name} = Rs.${sub}\n`;
  }
  text += `\n💰 *Total: Rs.${total}*`;
  return { text, total };
}

// ─── SAVE & PROCESS ORDER ───────────────────────────────
async function saveOrder(order) {
  let data = [];
  try { data = JSON.parse(await fs.promises.readFile(ORDERS_FILE)); } catch {}
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
    `✅ *ORDER CONFIRMED!*\n\nOrder ID: ${order.id}\nTotal: Rs.${total}\n\nHum jald deliver karenge! 🛵`
  );
  await sendText(OWNER_NUMBER,
    `📦 *NEW ORDER*\n\nID: ${order.id}\nName: ${order.name}\nPhone: ${order.phone}\nAddress: ${order.address}\n\n${text}`
  );
  resetSession(from);
}

// ─── MAIN MESSAGE HANDLER ────────────────────────────────
async function handleMessage(from, text) {
  const session = getSession(from);
  const msg = text.toLowerCase().trim();

  console.log(`📩 [${from}] "${text}" | step: ${session.step}`);

  // ── GLOBAL TRIGGERS ──
  if (/^(menu|start|hi|hello|salam|order|assalam)/.test(msg)) {
    resetSession(from);
    const s = getSession(from);
    s.step = 'main';

    await sendText(from, '👋 *Restaurant mein khush amdeed!*\n\nAap ka order lene ke liye hum tayar hain. 😊');
    await sendButtons(from, 'Kya karna chahte hain?', [
      { id: 'view_menu',  title: '📋 Menu Dekhen' },
      { id: 'view_cart',  title: '🛒 Cart Dekhen' },
      { id: 'get_help',   title: '❓ Help' }
    ]);
    return;
  }

  if (msg === 'cancel' || msg === '❌ cancel') {
    resetSession(from);
    await sendText(from, "❌ Order cancel ho gaya.\n\n'menu' likh kar dobara shuru karen.");
    return;
  }

  // ── STEP: main (after welcome) ──
  if (session.step === 'main') {
    if (msg.includes('menu') || text === 'view_menu') {
      session.step = 'browsing';
      await sendMenuList(from);
      return;
    }
    if (msg.includes('cart') || text === 'view_cart') {
      if (session.cart.length === 0) {
        await sendText(from, '🛒 Cart khali hai!');
        await sendButtons(from, 'Kya karna chahte hain?', [
          { id: 'view_menu', title: '📋 Menu Dekhen' },
          { id: 'get_help',  title: '❓ Help' }
        ]);
      } else {
        const { text: ct } = cartText(session.cart);
        await sendText(from, ct);
        await sendButtons(from, 'Aage kya karen?', [
          { id: 'add_more',  title: '➕ Aur Items' },
          { id: 'checkout',  title: '✅ Checkout' },
          { id: 'cancel',    title: '❌ Cancel' }
        ]);
        session.step = 'cart';
      }
      return;
    }
    if (msg.includes('help') || text === 'get_help') {
      await sendText(from,
        '📖 *Commands:*\n• menu — Menu dekhen\n• cart — Cart dekhen\n• cancel — Order cancel karen\n• checkout — Order place karen'
      );
      return;
    }
  }

  // ── STEP: browsing — user picks from menu list ──
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
    // If user typed something random while browsing
    await sendText(from, '⚠️ Please menu se item select karen.');
    await sendMenuList(from);
    return;
  }

  // ── STEP: cart ──
  if (session.step === 'cart') {
    if (msg.includes('checkout') || text === 'checkout') {
      session.step = 'name';
      await sendText(from, '👤 Apna *naam* likhein:');
      return;
    }
    if (msg.includes('aur') || msg.includes('more') || text === 'add_more') {
      session.step = 'browsing';
      await sendMenuList(from);
      return;
    }
    if (msg.includes('cancel') || text === 'cancel') {
      resetSession(from);
      await sendText(from, "❌ Order cancel.\n\n'menu' likh kar dobara shuru karen.");
      return;
    }
    // Re-show options if random text
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
    const { text: ct, total } = cartText(session.cart);
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
    if (msg === 'yes' || text === 'yes' || msg.includes('confirm')) {
      await processOrder(from, session);
      return;
    }
    resetSession(from);
    await sendText(from, "❌ Order cancel.\n\n'menu' likh kar dobara shuru karen.");
    return;
  }

  // ── DEFAULT ──
  await sendText(from, "❓ Samajh nahi aaya.\n\n'menu' likh kar shuru karen ya 'help' likhein.");
}

// ─── EXPRESS APP ─────────────────────────────────────────
const app = express();
app.use(express.json());

app.get('/', (_, res) => res.json({ status: 'OK', name: 'WhatsApp Food Bot' }));
app.get('/health', (_, res) => res.json({ status: 'OK', sessions: sessions.size, uptime: process.uptime() }));
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
      from = msg.from || msg.chat_id?.split('@')[0];

      // Text message
      if (msg.text) text = msg.text.body || msg.text;

      // Interactive reply (button or list)
      if (msg.interactive) {
        if (msg.interactive.button_reply) {
          // Use the ID so our handler can match it cleanly
          text = msg.interactive.button_reply.id;
        } else if (msg.interactive.list_reply) {
          text = msg.interactive.list_reply.id;
        }
      }

      if (!text) text = msg.body || '';
    }

    if (!from) from = data.from || data.sender?.phone;
    if (!text) text = data.text || data.body || '';

    console.log(`👤 From: ${from} | 💬 Text: ${text}`);
    if (from && text) await handleMessage(from, text);

  } catch (err) {
    console.error('❌ Webhook Error:', err);
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Bot running on port ${PORT}`);
});
