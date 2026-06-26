'use strict';

const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ─── CONFIG ─────────────────────────────────────────────
const WHAPI_TOKEN = 'sRfxCOYrER4XYRFoVJ5boPNCZAo34v4A';
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
    sessions.set(id, {
      step: 'idle',
      cart: [],
      name: null,
      address: null,
      phone: null
    });
  }
  return sessions.get(id);
}

function resetSession(id) {
  sessions.set(id, {
    step: 'idle',
    cart: [],
    name: null,
    address: null,
    phone: null
  });
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
    await api.post('/messages/text', {
      to: to,
      body: message
    });
    console.log('✅ Text sent');
  } catch (err) {
    console.error('❌ Send Text Error:', err.response?.data || err.message);
  }
}

// ─── SEND INTERACTIVE LIST ─────────────────────────────
async function sendInteractiveList(to, title, buttonText, items) {
  try {
    const payload = {
      to: to,
      type: 'list',
      body: {
        text: title
      },
      action: {
        button: buttonText || '📋 Open Menu',
        sections: [{
          title: '🍽 Menu Items',
          rows: items.map(item => ({
            id: item.id,
            title: item.name,
            description: `Rs.${item.price}`
          }))
        }]
      }
    };
    
    console.log('📤 Sending list');
    await api.post('/messages/interactive', payload);
    console.log('✅ List sent');
    return true;
  } catch (err) {
    console.error('❌ List Error:', err.response?.data || err.message);
    await sendText(to, items.map(i => `${i.id}. ${i.name} - Rs.${i.price}`).join('\n'));
    return false;
  }
}

// ─── SEND INTERACTIVE BUTTONS ──────────────────────────
async function sendInteractiveButtons(to, title, buttons) {
  try {
    const payload = {
      to: to,
      type: 'list',
      body: {
        text: title
      },
      action: {
        button: '📱 Select Option',
        sections: [{
          title: 'Options',
          rows: buttons.map((btn, index) => ({
            id: `btn_${index}`,
            title: btn,
            description: 'Tap to select'
          }))
        }]
      }
    };
    
    console.log('📤 Sending buttons');
    await api.post('/messages/interactive', payload);
    console.log('✅ Buttons sent');
    return true;
  } catch (err) {
    console.error('❌ Buttons Error:', err.response?.data || err.message);
    await sendText(to, `${title}\n${buttons.map((b, i) => `${i+1}. ${b}`).join('\n')}`);
    return false;
  }
}

// ─── CART ───────────────────────────────────────────────
function cartText(cart) {
  let total = 0;
  let text = "🛒 YOUR CART:\n";
  for (const i of cart) {
    const sub = i.qty * i.price;
    total += sub;
    text += `${i.qty}x ${i.name} = Rs.${sub}\n`;
  }
  return { text, total };
}

// ─── ORDER ──────────────────────────────────────────────
async function saveOrder(order) {
  let data = [];
  try {
    data = JSON.parse(await fs.promises.readFile(ORDERS_FILE));
  } catch {}
  data.push(order);
  await fs.promises.writeFile(ORDERS_FILE, JSON.stringify(data, null, 2));
}

async function processOrder(from, session) {
  const { text, total } = cartText(session.cart);
  const order = {
    id: "ORD" + Date.now(),
    from,
    name: session.name,
    address: session.address,
    phone: session.phone,
    items: session.cart,
    total,
    time: new Date().toISOString()
  };

  await saveOrder(order);
  await sendText(from, `✅ ORDER CONFIRMED!\nID: ${order.id}\nTotal: Rs.${total}`);
  await sendText(OWNER_NUMBER,
    `📦 NEW ORDER\n${order.id}\n${order.name}\n${order.phone}\n${order.address}\n\n${text}\nTotal: Rs.${total}`
  );
  resetSession(from);
}

// ─── MESSAGE HANDLER ────────────────────────────────────
async function handleMessage(from, text) {
  const session = getSession(from);
  const msg = text.toLowerCase().trim();

  console.log(`📩 ${from}: ${text}`);
  console.log(`🔄 Session step: ${session.step}`);

  // START
  if (msg.match(/^(menu|start|hi|hello|order)$/)) {
    resetSession(from);
    session.step = "main";
    
    await sendText(from, "👋 Welcome to Our Restaurant!");
    await sendInteractiveButtons(from, 
      "What would you like to do?", 
      ["📋 View Menu", "🛒 My Cart", "❓ Help"]
    );
    return;
  }

  // HELP
  if (msg.includes('help')) {
    await sendText(from, 
      "📖 Commands:\n" +
      "• menu - Show menu\n" +
      "• cart - View cart\n" +
      "• checkout - Place order\n" +
      "• cancel - Cancel order"
    );
    return;
  }

  // VIEW MENU
  if (msg.includes('view menu') || msg.includes('open menu')) {
    session.step = "browsing";
    await sendInteractiveList(from, 
      "🍽 Select your item:", 
      "📋 Open Menu", 
      MENU
    );
    return;
  }

  // MY CART
  if (msg.includes('my cart') || msg.includes('cart')) {
    if (session.cart.length === 0) {
      await sendText(from, "🛒 Your cart is empty!");
      await sendInteractiveButtons(from, "What would you like?", ["📋 View Menu", "❓ Help"]);
    } else {
      const { text: ctext } = cartText(session.cart);
      await sendText(from, ctext);
      await sendInteractiveButtons(from, "What next?", ["📋 Add More", "🛒 Checkout", "❌ Cancel"]);
    }
    return;
  }

  // MENU ITEM SELECTION
  if (session.step === "browsing") {
    const item = MENU.find(m => m.id === text.trim());
    if (item) {
      const ex = session.cart.find(c => c.id === item.id);
      if (ex) {
        ex.qty++;
        await sendText(from, `✅ Another ${item.name} added! (${ex.qty}x)`);
      } else {
        session.cart.push({ ...item, qty: 1 });
        await sendText(from, `✅ ${item.name} added to cart!`);
      }
      
      session.step = "cart";
      const { text: ctext } = cartText(session.cart);
      await sendText(from, ctext);
      await sendInteractiveButtons(from, "What next?", ["📋 More Items", "🛒 Checkout", "❌ Cancel"]);
      return;
    }
  }

  // CART ACTIONS
  if (session.step === "cart") {
    if (msg.includes("checkout")) {
      session.step = "name";
      await sendText(from, "👤 Enter your name:");
      return;
    }
    
    if (msg.includes("more items") || msg.includes("add more")) {
      session.step = "browsing";
      await sendInteractiveList(from, "🍽 Select more items:", "📋 Open Menu", MENU);
      return;
    }
    
    if (msg.includes("cancel")) {
      resetSession(from);
      await sendText(from, "❌ Order cancelled. Type 'menu' to start.");
      return;
    }
  }

  // NAME
  if (session.step === "name") {
    session.name = text;
    session.step = "address";
    await sendText(from, "📍 Enter delivery address:");
    return;
  }

  // ADDRESS
  if (session.step === "address") {
    session.address = text;
    session.step = "phone";
    await sendText(from, "📞 Enter phone number:");
    return;
  }

  // PHONE
  if (session.step === "phone") {
    session.phone = text;
    session.step = "confirm";
    
    const { text: ctext, total } = cartText(session.cart);
    await sendText(from, `📋 ORDER SUMMARY\n\n${ctext}\nTotal: Rs.${total}`);
    await sendInteractiveButtons(from, "Confirm order?", ["✅ Yes", "❌ No"]);
    return;
  }

  // CONFIRM
  if (session.step === "confirm") {
    if (msg === "yes" || msg === "✅ yes") {
      await processOrder(from, session);
      return;
    }
    resetSession(from);
    await sendText(from, "❌ Cancelled. Type 'menu' to start.");
    return;
  }

  // DEFAULT
  await sendText(from, "❓ Type 'menu' to start or 'help' for commands.");
}

// ─── APP ────────────────────────────────────────────────
const app = express();
app.use(express.json());

// Health Check
app.get('/', (req, res) => {
  res.json({ status: 'OK', name: 'WhatsApp Food Bot' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK', sessions: sessions.size, uptime: process.uptime() });
});

app.get('/webhook', (req, res) => {
  if (req.query.hub_challenge) return res.send(req.query.hub_challenge);
  res.sendStatus(200);
});

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  try {
    const data = req.body;
    console.log('📨 Webhook received');

    let from = null;
    let text = null;

    if (data.messages && Array.isArray(data.messages) && data.messages.length > 0) {
      const message = data.messages[0];
      from = message.from || message.chat_id?.split('@')[0];
      
      if (message.text) {
        text = message.text.body || message.text;
      }
      
      if (message.interactive) {
        if (message.interactive.button_reply) {
          text = message.interactive.button_reply.title;
        } else if (message.interactive.list_reply) {
          text = message.interactive.list_reply.id;
        }
      }
      
      if (!text) text = message.body || '';
    }

    if (!from) from = data.from || data.sender?.phone;
    if (!text) text = data.text || data.body || '';

    console.log(`👤 From: ${from}`);
    console.log(`💬 Text: ${text}`);

    if (from && text) {
      await handleMessage(from, text);
    }

  } catch (err) {
    console.error('❌ Webhook Error:', err);
  }
});

// ─── START ──────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Bot running on port ${PORT}`);
  console.log(`📱 Webhook: https://watsapp2-production.up.railway.app/webhook`);
});
