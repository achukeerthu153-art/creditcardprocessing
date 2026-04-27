"""
app.py  CREDIT CARD PROCESSING  SHOP | Flask Backend
Features: Auth, Products, Cards, Monthly Limit, EMI, PIN, Orders, Transactions
"""
import hashlib, os
from flask import Flask, request, jsonify, send_from_directory
from database import (db_init, db_get, db_all, db_run, db_transaction,
                      check_and_upgrade_tier, get_tier_progress,
                      TIERS, TIER_THRESHOLDS)

app = Flask(__name__, static_folder="static", template_folder="templates")
app.secret_key = "CREDIT CARD PROCESSING shop_secret_2024"

with app.app_context():
    db_init()

@app.after_request
def add_cors(r):
    r.headers["Access-Control-Allow-Origin"]  = "*"
    r.headers["Access-Control-Allow-Headers"] = "Content-Type"
    r.headers["Access-Control-Allow-Methods"] = "GET,POST,PUT,DELETE,OPTIONS"
    return r

@app.route("/api/<path:p>", methods=["OPTIONS"])
def options_handler(p): return jsonify({}), 200

@app.route("/")
def index(): return send_from_directory("templates", "index.html")

@app.route("/static/<path:f>")
def static_files(f): return send_from_directory("static", f)

# ── AUTH ─────────────────────────────────────────────────────
@app.route("/api/register", methods=["POST"])
def register():
    d = request.json or {}
    name, email, pw = d.get("name","").strip(), d.get("email","").strip().lower(), d.get("password","")
    if not name or not email or not pw:
        return jsonify({"error":"All fields required"}), 400
    if db_get("SELECT id FROM users WHERE email=?", (email,)):
        return jsonify({"error":"Email already registered"}), 409
    db_run("INSERT INTO users (name,email,password) VALUES (?,?,?)", (name,email,pw))
    return jsonify({"message":"Registered", "user":_su(db_get("SELECT * FROM users WHERE email=?", (email,)))}), 201

@app.route("/api/login", methods=["POST"])
def login():
    d = request.json or {}
    u = db_get("SELECT * FROM users WHERE email=? AND password=?",
               (d.get("email","").strip().lower(), d.get("password","")))
    if not u: return jsonify({"error":"Invalid credentials"}), 401
    return jsonify({"message":"Login successful","user":_su(u)}), 200

def _su(u):
    if not u: return None
    return {"id":u["id"],"name":u["name"],"email":u["email"],"created_at":u["created_at"]}

# ── USER ─────────────────────────────────────────────────────
@app.route("/api/user/<int:uid>")
def get_user(uid):
    u = db_get("SELECT * FROM users WHERE id=?", (uid,))
    if not u: return jsonify({"error":"Not found"}), 404
    return jsonify({"user":_su(u), "cards":_cards(uid)})

# ── PRODUCTS ─────────────────────────────────────────────────
@app.route("/api/products")
def get_products():
    return jsonify({"products":[dict(r) for r in db_all("SELECT * FROM products WHERE stock>0 ORDER BY id")]})

# ── CARDS ─────────────────────────────────────────────────────
@app.route("/api/cards/<int:uid>")
def list_cards(uid): return jsonify({"cards":_cards(uid)})

@app.route("/api/cards", methods=["POST"])
def add_card():
    d = request.json or {}
    uid = d.get("user_id")
    if not uid: return jsonify({"error":"user_id required"}), 400
    raw = str(d.get("card_number","")).replace(" ","")
    last4 = raw[-4:] if len(raw)>=4 else "0000"
    lim = float(d.get("credit_limit",100000))
    db_run("""INSERT INTO cards
        (user_id,card_type,card_holder,last4,expiry,card_network,bank_name,credit_limit,balance,monthly_limit)
        VALUES (?,?,?,?,?,?,?,?,?,?)""",
        (uid, d.get("card_type","credit"), d.get("card_holder","").strip(),
         last4, d.get("expiry",""), d.get("card_network","Visa"),
         d.get("bank_name",""), lim, lim, float(d.get("monthly_limit",50000))))
    return jsonify({"message":"Card added"}), 201

def _monthly_spent(uid, cid):
    r = db_get("""SELECT COALESCE(SUM(amount),0) AS s FROM transactions
        WHERE user_id=? AND card_id=? AND status='APPROVED'
        AND strftime('%Y-%m',created_at)=strftime('%Y-%m','now')""", (uid,cid))
    return float(r["s"]) if r else 0.0

def _cards(uid):
    rows = db_all("SELECT * FROM cards WHERE user_id=? ORDER BY id", (uid,))
    out = []
    for c in rows:
        spent = _monthly_spent(uid, c["id"])
        d = dict(c)
        has_pin = bool(d.pop("pin_hash", None))
        d.pop("pin", None)
        d["has_pin"]           = has_pin
        d["monthly_spent"]     = spent
        d["monthly_remaining"] = max(0.0, c["monthly_limit"] - spent)
        out.append(d)
    return out

# ── PIN ───────────────────────────────────────────────────────
def _hp(pin): return hashlib.sha256(pin.strip().encode()).hexdigest()

@app.route("/api/cards/<int:cid>/set-pin", methods=["POST"])
def set_pin(cid):
    d = request.json or {}
    uid, pin = d.get("user_id"), str(d.get("pin","")).strip()
    if not uid or len(pin)!=4 or not pin.isdigit():
        return jsonify({"error":"Valid 4-digit PIN required"}), 400
    if not db_get("SELECT id FROM cards WHERE id=? AND user_id=?", (cid,uid)):
        return jsonify({"error":"Card not found"}), 404
    db_run("UPDATE cards SET pin_hash=? WHERE id=?", (_hp(pin), cid))
    return jsonify({"message":"PIN set successfully"}), 200

@app.route("/api/cards/<int:cid>/verify-pin", methods=["POST"])
def verify_pin(cid):
    d = request.json or {}
    uid, pin = d.get("user_id"), str(d.get("pin","")).strip()
    if not uid or not pin: return jsonify({"error":"user_id and pin required"}), 400
    card = db_get("SELECT pin_hash FROM cards WHERE id=? AND user_id=?", (cid,uid))
    if not card: return jsonify({"error":"Card not found"}), 404
    if not card["pin_hash"]: return jsonify({"verified":True,"no_pin":True}), 200
    return jsonify({"verified": card["pin_hash"]==_hp(pin)}), 200

# ── CHECKOUT ──────────────────────────────────────────────────
@app.route("/api/checkout", methods=["POST"])
def checkout():
    d = request.json or {}
    uid, card_id, items = d.get("user_id"), d.get("card_id"), d.get("items",[])
    pay_method, emi_months = d.get("payment_method","credit"), int(d.get("emi_months",0))
    if not uid or not items: return jsonify({"error":"user_id and items required"}), 400

    subtotal, order_items = 0.0, []
    for it in items:
        p = db_get("SELECT * FROM products WHERE id=?", (it["product_id"],))
        if not p: return jsonify({"error":f"Product {it['product_id']} not found"}), 404
        if p["stock"] < it["qty"]: return jsonify({"error":f"Insufficient stock: {p['name']}"}), 400
        line = it["qty"]*p["price"]; subtotal += line
        order_items.append({**dict(p),"qty":it["qty"],"line_total":line})

    ship = 0.0 if subtotal>5000 else 99.0
    tax  = round(subtotal*0.18, 2)
    total = subtotal+ship+tax

    emi_int, emi_amt, emi_mo = 0.0, 0.0, 0.0
    if emi_months>0 and pay_method=="credit":
        rate    = {3:1.0,6:1.5,9:1.75,12:2.0}.get(emi_months,1.5)/100.0
        emi_int = round(total*rate*emi_months, 2)
        emi_amt = total+emi_int; emi_mo = round(emi_amt/emi_months, 2)
    charge = emi_amt if emi_months>0 else total

    status, reason = "APPROVED", ""
    if pay_method in ("credit","debit") and card_id:
        card = db_get("SELECT * FROM cards WHERE id=? AND user_id=?", (card_id,uid))
        if not card: return jsonify({"error":"Card not found"}), 404
        spent = _monthly_spent(uid, card_id)
        mon_rem = card["monthly_limit"]-spent
        if card["balance"]<charge:
            status="DECLINED"; reason=f"Insufficient balance. Available ₹{card['balance']:,.0f}, Need ₹{charge:,.0f}"
        elif mon_rem<charge:
            status="DECLINED"; reason=f"Monthly limit exceeded. Limit ₹{card['monthly_limit']:,.0f} | Spent ₹{spent:,.0f} | Remaining ₹{mon_rem:,.0f}"

    ops = []
    if status=="APPROVED" and pay_method in ("credit","debit") and card_id:
        ops.append(("UPDATE cards SET balance=balance-? WHERE id=?", (charge,card_id)))
    ops.append(("""INSERT INTO orders
        (user_id,card_id,subtotal,shipping,tax,total,payment_method,emi_months,emi_monthly_amount,emi_interest,status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
        (uid,card_id,subtotal,ship,tax,total,pay_method,emi_months,emi_mo,emi_int,status)))
    try: order_id = db_transaction(ops)
    except Exception as e: return jsonify({"error":str(e)}), 500

    item_ops = []
    for it in order_items:
        item_ops.append(("INSERT INTO order_items (order_id,product_id,qty,unit_price,line_total) VALUES (?,?,?,?,?)",
            (order_id,it["id"],it["qty"],it["price"],it["line_total"])))
        if status=="APPROVED":
            item_ops.append(("UPDATE products SET stock=stock-? WHERE id=?", (it["qty"],it["id"])))
    txn_ref = f"TXN{order_id:06d}"
    item_ops.append(("""INSERT INTO transactions
        (user_id,order_id,card_id,amount,payment_method,status,txn_ref,decline_reason)
        VALUES (?,?,?,?,?,?,?,?)""", (uid,order_id,card_id,charge,pay_method,status,txn_ref,reason)))
    try: db_transaction(item_ops)
    except Exception as e: return jsonify({"error":str(e)}), 500

    # ── auto-check tier upgrade after approved payment ────────
    tier_upgrade = None
    if status == "APPROVED" and pay_method in ("credit","debit") and card_id:
        tier_upgrade = check_and_upgrade_tier(uid, card_id)

    resp = {"status":status,"decline_reason":reason,"txn_ref":txn_ref,"order_id":order_id,
            "subtotal":subtotal,"shipping":ship,"tax":tax,"total":total,"charge":charge,
            "payment_method":pay_method,"emi_months":emi_months,"emi_monthly_amount":emi_mo,
            "emi_interest":emi_int,"items":order_items}
    if pay_method in ("credit","debit") and card_id:
        uc = db_get("SELECT * FROM cards WHERE id=?", (card_id,))
        sp = _monthly_spent(uid,card_id)
        resp["card"] = {**dict(uc),"monthly_spent":sp,"monthly_remaining":max(0.0,uc["monthly_limit"]-sp)}
    if tier_upgrade:
        resp["tier_upgrade"] = tier_upgrade
    return jsonify(resp), 200

# ── TRANSACTIONS ──────────────────────────────────────────────
@app.route("/api/transactions/<int:uid>")
def get_transactions(uid):
    rows = db_all("""SELECT t.*,o.subtotal,o.tax,o.shipping,o.emi_months,o.emi_monthly_amount,o.emi_interest,
        c.card_holder,c.last4,c.card_type,c.card_network
        FROM transactions t JOIN orders o ON t.order_id=o.id LEFT JOIN cards c ON t.card_id=c.id
        WHERE t.user_id=? ORDER BY t.created_at DESC LIMIT 50""", (uid,))
    return jsonify({"transactions":[dict(r) for r in rows]})

# ── ORDERS ────────────────────────────────────────────────────
@app.route("/api/orders/<int:uid>")
def get_orders(uid):
    orders = db_all("SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 20", (uid,))
    result = []
    for o in orders:
        its = db_all("""SELECT oi.*,p.name,p.emoji,p.tag
            FROM order_items oi JOIN products p ON oi.product_id=p.id WHERE oi.order_id=?""", (o["id"],))
        result.append({**dict(o),"items":[dict(i) for i in its]})
    return jsonify({"orders":result})

# ── EMI CALCULATOR ────────────────────────────────────────────
@app.route("/api/emi/calculate", methods=["POST"])
def calc_emi():
    d = request.json or {}
    amt, mo = float(d.get("amount",0)), int(d.get("months",3))
    rate = {3:1.0,6:1.5,9:1.75,12:2.0}.get(mo,1.5)/100.0
    interest = round(amt*rate*mo, 2)
    total = amt+interest
    return jsonify({"principal":amt,"months":mo,"interest_rate_pm":rate*100,
        "total_interest":interest,"total_amount":total,"monthly_emi":round(total/mo,2)})


# ── TIER UPGRADE ──────────────────────────────────────────────
@app.route("/api/cards/<int:cid>/tier", methods=["GET"])
def card_tier(cid):
    uid = request.args.get("user_id", type=int)
    if not uid:
        return jsonify({"error":"user_id required"}), 400
    progress = get_tier_progress(uid, cid)
    if progress is None:
        return jsonify({"error":"Card not found"}), 404
    return jsonify({"tier_progress": progress,
                    "tiers": TIERS,
                    "thresholds": TIER_THRESHOLDS})

@app.route("/api/user/<int:uid>/tier-upgrades", methods=["GET"])
def tier_history(uid):
    rows = db_all(
        """SELECT tu.*, c.last4, c.card_network, c.bank_name
           FROM tier_upgrades tu JOIN cards c ON tu.card_id=c.id
           WHERE tu.user_id=? ORDER BY tu.upgraded_at DESC, tu.id DESC""", (uid,)
    )
    return jsonify({"upgrades": [dict(r) for r in rows]})

if __name__ == "__main__":
    app.run(debug=True, port=5000)
