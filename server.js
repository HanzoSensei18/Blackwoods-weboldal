
require("dotenv").config();

const express = require("express");
const session = require("express-session");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const notifier = require("node-notifier");

const app = express();
const PORT = 3000;

if (!process.env.ADMIN_USER ||
    !process.env.ADMIN_PASSWORD ||
    !process.env.SESSION_SECRET) {
  throw new Error("Hianyoznak a .env fajl beallitasai.");
}

const dataDir = path.join(__dirname, "data");
const ordersFile = path.join(dataDir, "orders.json");

fs.mkdirSync(dataDir, { recursive: true });

if (!fs.existsSync(ordersFile)) {
  fs.writeFileSync(ordersFile, "[]", "utf8");
}

const MENU = {
  deadman: ["Dead Man's Burger", 2800],
  outlaw: ["Outlaw Burger", 2700],
  reaper: ["Reaper Burger (Csípős)", 2900],
  ribs: ["Blackwood BBQ Ribs", 3400],
  plate: ["Dead Man's Plate (Grillezett hústál)", 3700],
  heartstopper: ["Heartstopper", 2500],
  wings: ["Hell Wings (Csípős)", 2000],
  buffalo: ["Buffalo Chicken Bites", 1600],
  fish: ["Fish & Chips", 1500],
  potato: ["Steak Burgonya", 1200],
  brownie: ["Blackout Brownie", 1600],
  waffle: ["Sinner's Waffle", 1800],
  desert: ["Desert Storm", 1000],
  laststop: ["Last Stop", 1000],
  ipa: ["Highway 69 IPA", 1500],
  bloody: ["Bloody Outlaw", 1300],
  kiss: ["Reaper's Kiss", 3000],
  devil: ["Devil's Shots", 700],
  latte: ["Hellride Pumkin Spice Latte", 1100],
  taco: ["Taco", 1500],
  wrap: ["Csirkés Wrap", 1500]
};

function readOrders() {
  return JSON.parse(fs.readFileSync(ordersFile, "utf8"));
}

function saveOrders(orders) {
  fs.writeFileSync(
    ordersFile,
    JSON.stringify(orders, null, 2),
    "utf8"
  );
}

app.disable("x-powered-by");
app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false }));

app.use(session({
  name: "blackwoods.sid",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "strict",
    secure: false,
    maxAge: 2 * 60 * 60 * 1000
  }
}));

app.use(express.static(path.join(__dirname, "public")));

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin === true) {
    return next();
  }

  return res.status(401).json({
    error: "Bejelentkezes szukseges."
  });
}

app.get("/api/status", (req, res) => {
  res.json({
    name: "Blackwoods Bar&Grill",
    status: "running"
  });
});

// Admin belepes
app.post("/api/admin/login", (req, res, next) => {
  const { username, password } = req.body || {};

  if (
    typeof username !== "string" ||
    typeof password !== "string" ||
    username !== process.env.ADMIN_USER ||
    password !== process.env.ADMIN_PASSWORD
  ) {
    return res.status(401).json({
      error: "Hibas felhasznalonev vagy jelszo."
    });
  }

  req.session.regenerate(err => {
    if (err) return next(err);

    req.session.isAdmin = true;

    req.session.save(err => {
      if (err) return next(err);
      res.json({ success: true });
    });
  });
});

app.get("/api/admin/session", (req, res) => {
  res.json({
    authenticated: req.session?.isAdmin === true
  });
});

app.post("/api/admin/logout", requireAdmin, (req, res, next) => {
  req.session.destroy(err => {
    if (err) return next(err);

    res.clearCookie("blackwoods.sid", {
      httpOnly: true,
      sameSite: "strict",
      secure: false
    });

    res.json({ success: true });
  });
});

// Uj rendeles rogzitese, szerveroldali arakkal
app.post("/api/orders", (req, res) => {
  const {
    customerName,
    phone,
    method,
    address,
    requestedTime,
    note,
    items
  } = req.body || {};

  if (
    typeof customerName !== "string" ||
    !customerName.trim() ||
    typeof phone !== "string" ||
    !phone.trim() ||
    !["delivery", "pickup"].includes(method) ||
    !Array.isArray(items) ||
    items.length === 0 ||
    items.length > Object.keys(MENU).length
  ) {
    return res.status(400).json({
      error: "Ellenorizd a rendeles adatait."
    });
  }

  if (
    method === "delivery" &&
    (typeof address !== "string" || !address.trim())
  ) {
    return res.status(400).json({
      error: "Kiszallitashoz cim szukseges."
    });
  }

  const cleanItems = [];
  const seen = new Set();

  for (const item of items) {
    if (
      !item ||
      typeof item.id !== "string" ||
      !Object.prototype.hasOwnProperty.call(MENU, item.id) ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 50 ||
      seen.has(item.id)
    ) {
      return res.status(400).json({
        error: "Ervenytelen termek vagy mennyiseg."
      });
    }

    seen.add(item.id);

    const [name, price] = MENU[item.id];

    cleanItems.push({
      id: item.id,
      name,
      price,
      quantity: item.quantity
    });
  }

  const orders = readOrders();

  const order = {
    id: crypto.randomUUID(),
    customerName: customerName.trim().slice(0, 100),
    phone: phone.trim().slice(0, 40),
    method,
    address: method === "delivery"
      ? address.trim().slice(0, 300)
      : "",
    requestedTime: typeof requestedTime === "string"
      ? requestedTime.trim().slice(0, 100)
      : "",
    note: typeof note === "string"
      ? note.trim().slice(0, 500)
      : "",
    items: cleanItems,
    total: cleanItems.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    ),
    status: "Új",
    createdAt: new Date().toISOString()
  };

  orders.push(order);
  saveOrders(orders);

  console.log("Uj rendeles erkezett:", order.id);

  // Windows asztali ertesites
  try {
    notifier.notify({
      title: "Blackwoods Bar & Grill",
      message:
        "Uj rendeles erkezett!\n" +
        order.customerName +
        "\nVegosszeg: $" +
        order.total.toLocaleString("de-DE"),
      sound: true,
      wait: false
    });
  } catch (error) {
    console.error(
      "Az asztali ertesites nem sikerult:",
      error.message
    );
  }

  res.status(201).json({
    success: true,
    orderId: order.id,
    message: "A rendelesedet rogzitettuk."
  });
});

// Rendelesek listazasa, csak adminnak
app.get("/api/admin/orders", requireAdmin, (req, res) => {
  res.json(readOrders().slice().reverse());
});

// Rendeles allapotanak modositasa
app.patch("/api/admin/orders/:id", requireAdmin, (req, res) => {
  const allowedStatuses = [
    "Új",
    "Folyamatban",
    "Teljesítve",
    "Elutasítva"
  ];

  const { status } = req.body || {};

  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({
      error: "Ervenytelen allapot."
    });
  }

  const orders = readOrders();
  const order = orders.find(item => item.id === req.params.id);

  if (!order) {
    return res.status(404).json({
      error: "A rendeles nem talalhato."
    });
  }

  order.status = status;
  saveOrders(orders);

  res.json({ success: true });
});

// Rendeles torlese, csak adminnak
app.delete("/api/admin/orders/:id", requireAdmin, (req, res) => {
  const orders = readOrders();
  const remaining = orders.filter(
    item => item.id !== req.params.id
  );

  if (remaining.length === orders.length) {
    return res.status(404).json({
      error: "A rendeles nem talalhato."
    });
  }

  saveOrders(remaining);
  res.json({ success: true });
});

app.listen(PORT, "127.0.0.1", () => {
  console.log("");
  console.log("BLACKWOODS BAR & GRILL");
  console.log(`Et lap: http://localhost:${PORT}`);
  console.log(`Admin: http://localhost:${PORT}/admin.html`);
  console.log("A szerver mukodik!");
  console.log("Leallitas: CTRL + C");
});
