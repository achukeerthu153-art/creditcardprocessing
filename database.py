"""
database.py — CREDIT CARD PROCESSING SHOP  |  SQLite Database Layer
=======================================================
Tables
  users         — registered user accounts
  cards         — saved payment cards per user
                  (pin_hash stores SHA-256 of 4-digit PIN)
                  (tier: CLASSIC → SILVER → GOLD → PLATINUM)
  products      — product catalogue with stock
  orders        — placed orders (approved or declined)
  order_items   — line-items per order
  transactions  — every payment attempt, status, txn_ref
  tier_upgrades — full audit log of every tier promotion
=======================================================

CARD TIER SYSTEM
────────────────
Tier promotion is driven by the user's cumulative ALL-TIME
approved spend on that specific card:

  CLASSIC   →  SILVER    :  ₹ 10,000  lifetime spend
  SILVER    →  GOLD      :  ₹ 50,000  lifetime spend
  GOLD      →  PLATINUM  :  ₹1,00,000 lifetime spend

On promotion the card gets:
  • Higher credit_limit   (+₹50,000 per tier step)
  • Higher monthly_limit  (+₹25,000 per tier step)
  • balance raised by the same delta (free headroom)
  • tier_upgraded_at timestamp recorded
  • An entry written to tier_upgrades for audit
=======================================================
"""
import sqlite3, os

# Support overriding DB path for tests
DB_PATH = os.environ.get(
    "LUXE_TEST_DB",
    os.path.join(os.path.dirname(__file__), "CREDIT CARD PROCESSING shop.db")
)

# ──────────────────────────────────────────────────────────────
#  TIER CONFIGURATION
# ──────────────────────────────────────────────────────────────
TIERS = ["CLASSIC", "SILVER", "GOLD", "PLATINUM"]

# Minimum cumulative spend (₹) required to HOLD each tier
TIER_THRESHOLDS = {
    "CLASSIC":   0,
    "SILVER":    10_000,
    "GOLD":      50_000,
    "PLATINUM": 100_000,
}

# Benefits added PER tier step upgrade
TIER_CREDIT_LIMIT_BUMP  = 50_000   # ₹
TIER_MONTHLY_LIMIT_BUMP = 25_000   # ₹


# ──────────────────────────────────────────────────────────────
#  CONNECTION HELPERS
# ──────────────────────────────────────────────────────────────

def get_conn():
    """Open and return a connection with Row factory."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def db_get(sql, params=()):
    """Return the first matching row, or None."""
    conn = get_conn()
    try:
        return conn.execute(sql, params).fetchone()
    finally:
        conn.close()


def db_all(sql, params=()):
    """Return all matching rows as a list."""
    conn = get_conn()
    try:
        return conn.execute(sql, params).fetchall()
    finally:
        conn.close()


def db_run(sql, params=()):
    """Execute a single INSERT / UPDATE / DELETE and commit."""
    conn = get_conn()
    try:
        conn.execute(sql, params)
        conn.commit()
    finally:
        conn.close()


def db_transaction(ops):
    """
    Execute a list of (sql, params) tuples inside ONE connection
    so foreign-key references between statements are satisfied.
    Returns the lastrowid of the FIRST INSERT statement.

    Example:
        order_id = db_transaction([
            ("INSERT INTO orders ...", (...)),
            ("INSERT INTO order_items ...", (...)),
            ("INSERT INTO transactions ...", (...)),
        ])
    """
    conn = get_conn()
    first_id = None
    try:
        cur = conn.cursor()
        for sql, params in ops:
            cur.execute(sql, params)
            if first_id is None and sql.strip().upper().startswith("INSERT"):
                first_id = cur.lastrowid
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return first_id


# ──────────────────────────────────────────────────────────────
#  SCHEMA  +  SEED DATA
# ──────────────────────────────────────────────────────────────

def db_init():
    """Create all tables, run safe migrations, seed demo data."""
    conn = get_conn()
    c    = conn.cursor()

    # ── users ─────────────────────────────────────────────────
    c.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT    NOT NULL,
        email      TEXT    NOT NULL UNIQUE,
        password   TEXT    NOT NULL,
        created_at TEXT    DEFAULT (datetime('now','localtime'))
    )""")

    # ── cards ─────────────────────────────────────────────────
    # pin_hash         : SHA-256 of the 4-digit PIN (NULL = no PIN set)
    # tier             : CLASSIC | SILVER | GOLD | PLATINUM
    # tier_upgraded_at : timestamp of last tier promotion
    c.execute("""
    CREATE TABLE IF NOT EXISTS cards (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id          INTEGER NOT NULL,

        card_type        TEXT    NOT NULL DEFAULT 'credit',
        card_holder      TEXT    NOT NULL,
        last4            TEXT    NOT NULL,
        expiry           TEXT    NOT NULL,
        card_network     TEXT    DEFAULT 'Visa',
        bank_name        TEXT    DEFAULT '',

        credit_limit     REAL    DEFAULT 100000,
        balance          REAL    DEFAULT 100000,
        monthly_limit    REAL    DEFAULT 50000,

        pin_hash         TEXT    DEFAULT NULL,
        pin              TEXT    DEFAULT NULL,
        card_color       TEXT    DEFAULT 'default',

        tier             TEXT    DEFAULT 'CLASSIC',
        tier_upgraded_at TEXT    DEFAULT NULL,

        created_at       TEXT    DEFAULT (datetime('now','localtime'))
    )""")

    # ── products ──────────────────────────────────────────────
    c.execute("""
    CREATE TABLE IF NOT EXISTS products (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL,
        tag         TEXT    NOT NULL,
        emoji       TEXT    NOT NULL,
        price       REAL    NOT NULL,
        stock       INTEGER DEFAULT 100,
        description TEXT,
        created_at  TEXT    DEFAULT (datetime('now','localtime'))
    )""")

    # ── orders ────────────────────────────────────────────────
    c.execute("""
    CREATE TABLE IF NOT EXISTS orders (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id            INTEGER NOT NULL,
        card_id            INTEGER,

        subtotal           REAL    NOT NULL,
        shipping           REAL    DEFAULT 0,
        tax                REAL    DEFAULT 0,
        total              REAL    NOT NULL,

        payment_method     TEXT    DEFAULT 'credit',
        emi_months         INTEGER DEFAULT 0,
        emi_monthly_amount REAL    DEFAULT 0,
        emi_interest       REAL    DEFAULT 0,

        status             TEXT    DEFAULT 'APPROVED',
        created_at         TEXT    DEFAULT (datetime('now','localtime'))
    )""")

    # ── order_items ───────────────────────────────────────────
    c.execute("""
    CREATE TABLE IF NOT EXISTS order_items (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id    INTEGER NOT NULL,
        product_id  INTEGER NOT NULL,
        qty         INTEGER NOT NULL,
        unit_price  REAL    NOT NULL,
        line_total  REAL    NOT NULL
    )""")

    # ── transactions ──────────────────────────────────────────
    c.execute("""
    CREATE TABLE IF NOT EXISTS transactions (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id        INTEGER NOT NULL,
        order_id       INTEGER NOT NULL,
        card_id        INTEGER,

        amount         REAL    NOT NULL,
        payment_method TEXT,
        status         TEXT    DEFAULT 'APPROVED',
        txn_ref        TEXT,
        decline_reason TEXT    DEFAULT '',

        created_at     TEXT    DEFAULT (datetime('now','localtime'))
    )""")

    conn.commit()

    # ── safe migrations for already-existing databases ────────
    # Each ALTER TABLE is tried silently; if the column already
    # exists SQLite raises OperationalError which we swallow.
    _migrations = [
        "ALTER TABLE cards ADD COLUMN bank_name        TEXT DEFAULT ''",
        "ALTER TABLE cards ADD COLUMN card_color       TEXT DEFAULT 'default'",
        "ALTER TABLE cards ADD COLUMN pin_hash         TEXT DEFAULT NULL",
        "ALTER TABLE cards ADD COLUMN pin              TEXT DEFAULT NULL",
        "ALTER TABLE cards ADD COLUMN tier             TEXT DEFAULT 'CLASSIC'",
        "ALTER TABLE cards ADD COLUMN tier_upgraded_at TEXT DEFAULT NULL",
    ]
    for sql in _migrations:
        try:
            c.execute(sql)
            conn.commit()
        except Exception:
            pass   # column already exists — skip silently

    # ── tier_upgrades audit table ─────────────────────────────
    c.execute("""
    CREATE TABLE IF NOT EXISTS tier_upgrades (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL,
        card_id     INTEGER NOT NULL,
        old_tier    TEXT    NOT NULL,
        new_tier    TEXT    NOT NULL,
        total_spend REAL    NOT NULL,
        upgraded_at TEXT    DEFAULT (datetime('now','localtime'))
    )""")
    conn.commit()

    # ── seed only on a fresh (empty) database ─────────────────
    if c.execute("SELECT COUNT(*) FROM products").fetchone()[0] == 0:
        _seed(c, conn)

    conn.close()
    print(f"✅  Database ready → {DB_PATH}")


def _seed(c, conn):
    """Insert demo products, one demo user, and demo cards."""

    # 8 demo products
    products = [
        ("Noise-Cancelling Headphones", "Electronics", "🎧", 7999,  100, "Premium sound, 30hr battery, ANC."),
        ("Mechanical Keyboard",         "Electronics", "⌨️", 4499,   80, "TKL layout, tactile switches, RGB backlit."),
        ("Leather Wallet",              "Accessories", "👜", 1299,  200, "Full-grain leather, RFID blocking, slim."),
        ("Sunglasses",                  "Accessories", "🕶️", 2199,  150, "UV400 polarised lenses, titanium frame."),
        ("Luxury Perfume",              "Beauty",      "🧴", 3499,  120, "Woody-floral notes, 100ml, long lasting."),
        ("Smart Watch",                 "Wearables",   "⌚", 12999,  60, "AMOLED display, health tracking, 7-day battery."),
        ("Running Shoes",               "Footwear",    "👟", 5499,   90, "Lightweight, breathable mesh sole."),
        ("Coffee Maker",                "Kitchen",     "☕", 3299,   70, "12-cup drip brewing, programmable timer."),
    ]
    c.executemany(
        "INSERT INTO products (name,tag,emoji,price,stock,description) VALUES (?,?,?,?,?,?)",
        products
    )

    # Demo user  — login: demo@CREDIT CARD PROCESSING .com / demo123
    c.execute(
        "INSERT OR IGNORE INTO users (name,email,password) VALUES (?,?,?)",
        ("Demo User", "demo@CREDIT CARD PROCESSING .com", "demo123")
    )
    uid = c.execute("SELECT id FROM users WHERE email='demo@CREDIT CARD PROCESSING .com'").fetchone()["id"]

    # Demo cards
    # Columns: user_id, card_type, card_holder, last4, expiry,
    #          card_network, bank_name, card_color,
    #          credit_limit, balance, monthly_limit
    demo_cards = [
        # ── Credit cards (PIN must be set before first use) ───
        (uid, "credit", "Demo User", "4242", "12/27", "Visa",       "HDFC Bank",   "visa",       150000, 120000,  75000),
        (uid, "credit", "Demo User", "5531", "09/26", "Mastercard", "ICICI Bank",  "mastercard", 200000, 185000, 100000),
        (uid, "credit", "Demo User", "6085", "03/28", "RuPay",      "SBI Bank",    "rupay",       80000,  65000,  40000),
        (uid, "credit", "Demo User", "3782", "11/25", "Amex",       "Amex India",  "amex",       300000, 260000, 150000),
        (uid, "credit", "Demo User", "6304", "06/27", "Maestro",    "Axis Bank",   "maestro",     50000,  42000,  25000),
        # ── Debit cards (no PIN required) ────────────────────
        (uid, "debit",  "Demo User", "4111", "08/26", "Visa",       "Kotak Bank",  "visa",        60000,  48000,  30000),
        (uid, "debit",  "Demo User", "5200", "01/28", "Mastercard", "Yes Bank",    "mastercard",  40000,  35000,  20000),
        (uid, "debit",  "Demo User", "6074", "07/27", "RuPay",      "PNB Bank",    "rupay",       30000,  27500,  15000),
    ]
    for dc in demo_cards:
        c.execute("""
            INSERT INTO cards
              (user_id, card_type, card_holder, last4, expiry,
               card_network, bank_name, card_color,
               credit_limit, balance, monthly_limit)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)""", dc)

    conn.commit()

# ──────────────────────────────────────────────────────────────
#  TIER UPGRADE ENGINE
# ──────────────────────────────────────────────────────────────

def get_card_lifetime_spend(uid, cid):
    """Return total approved spend on this card across all time."""
    r = db_get(
        "SELECT COALESCE(SUM(amount),0) AS s FROM transactions "
        "WHERE user_id=? AND card_id=? AND status='APPROVED'",
        (uid, cid)
    )
    return float(r["s"]) if r else 0.0


def resolve_tier(lifetime_spend):
    """Return the tier name the given spend qualifies for."""
    tier = "CLASSIC"
    for t in TIERS:
        if lifetime_spend >= TIER_THRESHOLDS[t]:
            tier = t
    return tier


def check_and_upgrade_tier(uid, cid):
    """
    Check if the card qualifies for a tier upgrade.
    If yes, apply it atomically, log to tier_upgrades, and
    return a dict describing the upgrade (or None if no change).

    Called automatically after every successful checkout.
    """
    card = db_get("SELECT * FROM cards WHERE id=? AND user_id=?", (cid, uid))
    if not card or card["card_type"] != "credit":
        return None                        # only credit cards get tiers

    current_tier = card["tier"] or "CLASSIC"
    if current_tier == "PLATINUM":
        return None                        # already at maximum

    lifetime_spend = get_card_lifetime_spend(uid, cid)
    earned_tier    = resolve_tier(lifetime_spend)

    # No upgrade needed
    if TIERS.index(earned_tier) <= TIERS.index(current_tier):
        return None

    # Calculate how many steps we're jumping (handles multi-step skips)
    old_idx  = TIERS.index(current_tier)
    new_idx  = TIERS.index(earned_tier)
    steps    = new_idx - old_idx

    credit_delta  = steps * TIER_CREDIT_LIMIT_BUMP
    monthly_delta = steps * TIER_MONTHLY_LIMIT_BUMP

    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """UPDATE cards
               SET tier             = ?,
                   tier_upgraded_at = datetime('now','localtime'),
                   credit_limit     = credit_limit  + ?,
                   monthly_limit    = monthly_limit + ?,
                   balance          = balance       + ?
               WHERE id = ?""",
            (earned_tier, credit_delta, monthly_delta, credit_delta, cid)
        )
        cur.execute(
            """INSERT INTO tier_upgrades
               (user_id, card_id, old_tier, new_tier, total_spend)
               VALUES (?, ?, ?, ?, ?)""",
            (uid, cid, current_tier, earned_tier, lifetime_spend)
        )
        conn.commit()
    finally:
        conn.close()

    return {
        "upgraded":      True,
        "card_id":       cid,
        "old_tier":      current_tier,
        "new_tier":      earned_tier,
        "lifetime_spend": lifetime_spend,
        "credit_limit_added":  credit_delta,
        "monthly_limit_added": monthly_delta,
        "next_tier":     TIERS[new_idx + 1] if new_idx < len(TIERS) - 1 else None,
        "next_tier_at":  TIER_THRESHOLDS[TIERS[new_idx + 1]] if new_idx < len(TIERS) - 1 else None,
    }


def get_tier_progress(uid, cid):
    """
    Return a dict with the card's tier status, lifetime spend,
    progress % toward the next tier, and amount remaining.
    """
    card = db_get("SELECT tier, credit_limit, monthly_limit FROM cards WHERE id=? AND user_id=?", (cid, uid))
    if not card:
        return None

    current_tier   = card["tier"] or "CLASSIC"
    current_idx    = TIERS.index(current_tier)
    lifetime_spend = get_card_lifetime_spend(uid, cid)

    if current_tier == "PLATINUM":
        return {
            "tier": "PLATINUM", "lifetime_spend": lifetime_spend,
            "next_tier": None, "next_tier_threshold": None,
            "amount_remaining": 0, "progress_pct": 100,
        }

    next_tier      = TIERS[current_idx + 1]
    current_floor  = TIER_THRESHOLDS[current_tier]
    next_threshold = TIER_THRESHOLDS[next_tier]
    span           = next_threshold - current_floor
    earned         = max(0, lifetime_spend - current_floor)
    pct            = min(100, round(earned / span * 100, 1))

    return {
        "tier":               current_tier,
        "lifetime_spend":     round(lifetime_spend, 2),
        "next_tier":          next_tier,
        "next_tier_threshold": next_threshold,
        "amount_remaining":   round(max(0, next_threshold - lifetime_spend), 2),
        "progress_pct":       pct,
    }
