'use strict';

const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');


// ─── CONFIG ─────────────────────────────────────────────
const WHAPI_TOKEN = 'sRfxCOYrER4XYRFoVJ5boPNCZAo34v4A';
const WHAPI_URL = 'https://gate.whapi.cloud/';
const OWNER_NUMBER = process.env.OWNER_NUMBER || '923371240707';
const PORT = process.env.PORT || 3000;
const ORDERS_FILE = path.join(__dirname, 'orders.json');

// ─── MENU ───────────────────────────────────────────────
const MENU = [
  { id: '1', name: 'Chicken Roast (Full)', price: 1350, desc: 'Fresh' },
  { id: '2', name: 'Chicken Roast (Half)', price: 700, desc: 'Fresh' },
  { id: '3', name: 'Shami Kabab (12 Pcs)', price: 600, desc: 'Tasty' },
  { id: '4', name: 'Chicken Piece', price: 180, desc: '' },
  { id: '5', name: 'Salad', price: 20, desc: '' },
  { id: '6', name: 'Raita', price: 20, desc: '' }
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

// ─── SEND MESSAGE ──────────────────────────────────────
async function sendText(to, message) {
  try {
    const response = await api.post('/messages/text', {
      to: to,
      text: message
    });
    console.log('Message sent:', response.data);
    return response.data;
  } catch (err) {
    console.error('Send Text Error:', err.response?.data || err.message);
  }
}

// ─── SEND INTERACTIVE BUTTONS ──────────────────────────
async function sendButtons(to, title, buttons) {
  try {
    const response = await api.post('/messages/interactive', {
      to: to,
      type: 'button',
      interactive: {
        header: {
          type: 'text',
          text: '📱 Food Bot'
        },
        body: {
          text: title
        },
        footer: {
          text: 'Select an option'
        },
        action: {
          buttons: buttons.map((btn, index) => ({
            type: 'reply',
            reply: {
              id: `btn_${index}`,
              title: btn
            }
          }))
        }
      }
    });
    console.log('Buttons sent:', response.data);
    return response.data;
  } catch (err) {
    console.error('Send Buttons Error:', err.response?.data || err.message);
    // Fallback to text
    await sendText(to, `${title}\n\n${buttons.map((b, i) => `${i+1}. ${b}`).join('\n')}`);
  }
}

// ─── SEND LIST MESSAGE ──────────────────────────────────
async function sendList(to, title, body, buttonText, items) {
  try {
    const rows = items.map(item => ({
      id: item.id,
      title: item.name,
      description: `Rs.${item.price} - ${item.desc || 'Available'}`
    }));

    const response = await api.post('/messages/interactive', {
      to: to,
      type: 'list',
      interactive: {
        header: {
          type: 'text',
          text: '🍽 Menu'
        },
        body: {
          text: body || 'Select items from menu'
        },
        footer: {
          text: 'Tap to select'
        },
        action: {
          button: buttonText || '📋 View Menu',
          sections: [{
            title: 'Items',
            rows: rows
          }]
        }
      }
    });
    console.log('List sent:', response.data);
    return response.data;
  } catch (err) {
    console.error('Send List Error:', err.response?.data || err.message);
    // Fallback to text
    await sendText(to, items.map(i => `${i.id}. ${i.name} - Rs.${i.price}`).join('\n'));
  }
}

// ─── SEND TEMPLATE MESSAGE ──────────────────────────────
async function sendTemplate(to, templateName, params = []) {
  try {
    const response = await api.post('/messages/template', {
      to: to,
      template: {
        name: templateName,
        language: 'en',
        components: params.map(p => ({
          type: 'body',
          text: p
        }))
      }
    });
    return response.data;
  } catch (err) {
    console.error('Send Template Error:', err.response?.data || err.message);
  }
}

// ─── CART ───────────────────────────────────────────────
function cartText(cart) {
  let total = 0;
  let text = "🛒 CART:\n";
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
  
  // Customer confirmation
  await sendText(from, `🎉 Order Confirmed!\nID: ${order.id}\nTotal: Rs.${total}`);
  
  // Owner notification
  await sendText(OWNER_NUMBER,
    `📦 NEW ORDER\n${order.id}\n${order.name}\n${order.phone}\n${order.address}\n\n${text}\nTotal: Rs.${total}`
  );
  
  resetSession(from);
}

// ─── MESSAGE HANDLER ────────────────────────────────────
async function handleMessage(from, text) {
  const session = getSession(from);
  const msg = text.toLowerCase().trim();

  console.log(`Message from ${from}: ${text}`);

  // Health check
  if (msg === 'ping') {
    return sendText(from, '🏓 pong');
  }

  // START / MENU
  if (msg.match(/^(menu|start|hi|hello|order)$/)) {
    resetSession(from);
    session.step = "browsing";
    
    await sendText(from, "👋 Welcome to Our Restaurant!");
    await sendButtons(from, "What would you like to do?", ["📋 View Menu", "🛒 My Cart", "❓ Help"]);
    await sendList(from, "🍽 Menu", "Please select items to order:", "📋 Open Menu", MENU);
    return;
  }

  // BUTTON RESPONSES
  if (msg.includes('view menu') || msg.includes('open menu')) {
    session.step = "browsing";
    await sendList(from, "🍽 Menu", "Select items:", "📋 Open Menu", MENU);
    return;
  }

  if (msg.includes('my cart')) {
    const { text: cartText } = cartText(session.cart);
    if (session.cart.length === 0) {
      await sendText(from, "🛒 Your cart is empty!");
      await sendButtons(from, "What would you like to do?", ["📋 View Menu", "❓ Help"]);
    } else {
      await sendText(from, cartText);
      await sendButtons(from, "Cart Actions:", ["🛒 Checkout", "📋 More Items", "❌ Cancel"]);
    }
    return;
  }

  if (msg.includes('help')) {
    await sendText(from, 
      "📖 Commands:\n" +
      "• menu - Show menu\n" +
      "• cart - View cart\n" +
      "• checkout - Place order\n" +
      "• cancel - Cancel order\n" +
      "• help - Show this help"
    );
    return;
  }

  // LIST SELECTION (Menu Items)
  if (session.step === "browsing") {
    const item = MENU.find(m => m.id === text.trim());
    if (item) {
      const ex = session.cart.find(c => c.id === item.id);
      if (ex) {
        ex.qty++;
        await sendText(from, `✅ Added another ${item.name}! (${ex.qty}x)`);
      } else {
        session.cart.push({ ...item, qty: 1 });
        await sendText(from, `✅ Added ${item.name} to cart!`);
      }
      
      session.step = "cart";
      const { text: ctext } = cartText(session.cart);
      await sendText(from, ctext);
      await sendButtons(from, "What next?", ["📋 More Items", "🛒 Checkout", "❌ Cancel"]);
      return;
    }
  }

  // CART ACTIONS
  if (session.step === "cart") {
    if (msg.includes("checkout")) {
      session.step = "name";
      return sendText(from, "👤 Please enter your name:");
    }
    
    if (msg.includes("more items")) {
      session.step = "browsing";
      return sendList(from, "🍽 Menu", "Select more items:", "📋 Open Menu", MENU);
    }
    
    if (msg.includes("cancel")) {
      resetSession(from);
      return sendText(from, "❌ Order cancelled. Type 'menu' to start again.");
    }
  }

  // NAME
  if (session.step === "name") {
    session.name = text;
    session.step = "address";
    return sendText(from, "📍 Please enter delivery address:");
  }

  // ADDRESS
  if (session.step === "address") {
    session.address = text;
    session.step = "phone";
    return sendText(from, "📞 Please enter phone number:");
  }

  // PHONE
  if (session.step === "phone") {
    session.phone = text;
    session.step = "confirm";
    
    const { text: ctext, total } = cartText(session.cart);
    await sendText(from, `📋 ORDER SUMMARY\n\n${ctext}\nTotal: Rs.${total}`);
    await sendButtons(from, "Confirm your order?", ["✅ Yes", "❌ No"]);
    return;
  }

  // CONFIRM
  if (session.step === "confirm") {
    if (msg === "yes" || msg === "✅ yes") {
      return processOrder(from, session);
    }
    resetSession(from);
    return sendText(from, "❌ Order cancelled. Type 'menu' to start again.");
  }

  // Default response
  await sendText(from, "❓ I didn't understand that. Type 'menu' to start or 'help' for commands.");
}

// ─── APP ────────────────────────────────────────────────
const app = express();
app.use(express.json());

// Health Check
app.get('/', (req, res) => {
  res.json({
    status: 'OK',
    name: 'WhatsApp Food Bot',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    sessions: sessions.size,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString()
  });
});

// Webhook Verification
app.get('/webhook', (req, res) => {
  if (req.query.hub_challenge) {
    return res.send(req.query.hub_challenge);
  }
  res.sendStatus(200);
});

// ─── MAIN WEBBOOK HANDLER ──────────────────────────────
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  try {
    const data = req.body;
    console.log('📨 Webhook received');

    let from = null;
    let text = null;

    // 🔥 Parse Whapi messages array format
    if (data.messages && Array.isArray(data.messages) && data.messages.length > 0) {
      const message = data.messages[0];
      
      // Get sender
      from = message.from || message.sender?.phone || message.chat_id?.split('@')[0];
      
      // Get text
      if (message.text) {
        text = message.text.body || message.text;
      }
      
      // Handle interactive buttons
      if (message.interactive) {
        if (message.interactive.button_reply) {
          text = message.interactive.button_reply.title;
        } else if (message.interactive.list_reply) {
          text = message.interactive.list_reply.id;
        }
      }
      
      // Fallback
      if (!text) {
        text = message.body || message.text || '';
      }
    }

    // Direct format fallback (if webhook sends directly)
    if (!from) {
      from = data.from || data.sender?.phone || data.chat_id?.split('@')[0];
    }
    if (!text) {
      text = data.text || data.message?.text || data.body || '';
    }

    console.log(`👤 From: ${from}`);
    console.log(`💬 Text: ${text}`);

    if (from && text) {
      await handleMessage(from, text);
    } else {
      console.log('⚠️ No valid message to process');
    }

  } catch (err) {
    console.error('❌ Webhook Error:', err);
  }
});

// ─── START SERVER ───────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Whapi Food Bot running on port ${PORT}`);
  console.log(`📱 Webhook URL: https://watsapp2-production.up.railway.app/webhook`);
  console.log(`💚 Health Check: https://watsapp2-production.up.railway.app/health`);
});
