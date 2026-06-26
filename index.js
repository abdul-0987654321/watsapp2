'use strict';

const express = require('express');
const axios   = require('axios');
const fs      = require('fs');
const path    = require('path');


// ─── CONFIG ─────────────────────────────────────────────
const ID_INSTANCE  = '7107665041';
const API_TOKEN    = '790b8e8e4f294b80b37f6fb3804a57ad316d2cc00cad41ed9b';
const BASE_URL     = `https://7107.api.greenapi.com/waInstance${ID_INSTANCE}`;
const OWNER_NUMBER = '923371240707';
const PORT         = process.env.PORT || 3000;
const ORDERS_FILE  = path.join(__dirname, 'orders.json');

// ─── MENU ───────────────────────────────────────────────
const MENU = [
  { id: '1', name: 'Chicken Roast (Full)', price: 1350, desc: 'Fresh' },
  { id: '2', name: 'Chicken Roast (Half)', price: 700,  desc: 'Fresh' },
  { id: '3', name: 'Shami Kabab (12 Pcs)', price: 600,  desc: 'Tasty' },
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

// ─── API ────────────────────────────────────────────────
const api = axios.create({ baseURL: BASE_URL });

async function sendText(to, message) {
  const chatId = `${to.replace(/\D/g, '')}@c.us`;
  await api.post(`/sendMessage/${API_TOKEN}`, { chatId, message });
}

// ─── LIST BUTTON (MAIN UI) ─────────────────────────────
async function sendList(to, title, body, buttonText, items) {
  try {
    const chatId = `${to.replace(/\D/g, '')}@c.us`;

    const sections = [
      {
        title: "🍽 Menu",
        rows: items.map(i => ({
          id: i.id,
          title: `${i.name} - Rs.${i.price}`,
          description: i.desc || ""
        }))
      }
    ];

    await api.post(`/sendListMessage/${API_TOKEN}`, {
      chatId,
      message: body || "Select item",
      buttonText: buttonText || "Open Menu",
      sections
    });

  } catch (err) {
    console.error("List error:", err.response?.data || err.message);

    await sendText(
      to,
      items.map(i => `${i.id}. ${i.name} - Rs.${i.price}`).join('\n')
    );
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

  await sendText(from, `🎉 Order Confirmed!\nID: ${order.id}\nTotal: Rs.${total}`);

  await sendText(OWNER_NUMBER,
    `NEW ORDER\n${order.id}\n${order.name}\n${order.phone}\n${order.address}\n\n${text}\nTotal: Rs.${total}`
  );

  resetSession(from);
}

// ─── MESSAGE HANDLER ────────────────────────────────────
async function handleMessage(from, text) {
  const session = getSession(from);
  const msg = text.toLowerCase();

  // START → ONLY BUTTON MENU
  if (msg.match(/menu|start|hi|hello|order/)) {
    resetSession(from);
    session.step = "browsing";

    await sendText(from, "👋 Welcome!");
    await sendList(from, "🍽 Menu", "Select items:", "Open Menu", MENU);
    return;
  }

  // BUTTON CLICK (LIST RESPONSE)
  if (session.step === "browsing") {
    const item = MENU.find(m => m.id === text.trim());
    if (!item) return;

    const ex = session.cart.find(c => c.id === item.id);
    if (ex) ex.qty++;
    else session.cart.push({ ...item, qty: 1 });

    session.step = "cart";

    const { text: ctext } = cartText(session.cart);

    await sendText(from, ctext);
    await sendText(from, "🛒 Type 'checkout' or open menu");
    return;
  }

  // CART
  if (session.step === "cart") {
    if (msg.includes("checkout")) {
      session.step = "name";
      return sendText(from, "👤 Enter your name:");
    }

    if (msg.includes("menu")) {
      session.step = "browsing";
      return sendList(from, "🍽 Menu", "Select:", "Open Menu", MENU);
    }
  }

  // NAME
  if (session.step === "name") {
    session.name = text;
    session.step = "address";
    return sendText(from, "📍 Enter address:");
  }

  // ADDRESS
  if (session.step === "address") {
    session.address = text;
    session.step = "phone";
    return sendText(from, "📞 Enter phone:");
  }

  // PHONE
  if (session.step === "phone") {
    session.phone = text;
    session.step = "confirm";

    const { text: ctext, total } = cartText(session.cart);

    await sendText(from, `SUMMARY\n${ctext}\nTotal: Rs.${total}`);
    return sendText(from, "Type YES to confirm");
  }

  // CONFIRM
  if (session.step === "confirm") {
    if (msg === "yes") return processOrder(from, session);
    return sendText(from, "Cancelled ❌");
  }

  sendText(from, "Type menu");
}

// ─── WEBHOOK ────────────────────────────────────────────
const app = express();
app.use(express.json());

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  try {
    const data = req.body;

    if (data.typeWebhook !== 'incomingMessageReceived') return;

    const chatId = data?.senderData?.chatId;
    if (!chatId) return;

    let text = "";

    const msgType = data.messageData.typeMessage;

    if (msgType === "textMessage") {
      text = data.messageData.textMessageData.textMessage;
    } else if (msgType === "interactiveResponseMessage") {
      text = data.messageData.interactiveResponseMessageData.selectedRowId;
    }

    if (!text) return;

    const from = chatId.replace("@c.us", "");
    await handleMessage(from, text);

  } catch (e) {
    console.error(e);
  }
});

app.listen(PORT, () => console.log("🚀 Bot running"));
