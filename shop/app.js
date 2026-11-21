
const SUPABASE_URL = "https://tovdhcylsajhamscnmdm.supabase.co";
const SUPABASE_KEY = "sb_publishable_Q6StOz8xw0PK91aAgPAwyQ_lTRl0rU_";

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const grid = document.getElementById("productGrid");
const search = document.getElementById("searchInput");
const count = document.getElementById("productCount");
const empty = document.getElementById("emptyState");
const filters = document.querySelector(".filters");
const modal = document.getElementById("productModal");

let products = [];
let categories = [];
let activeFilter = "all";
let currentUser = null;
let selectedProduct = null;
let pendingPurchase = null;

function safe(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function categoryKey(category) {
  return category.slug || `id:${category.id}`;
}

function getCategory(product) {
  return categories.find(c =>
    String(c.id) === String(product.category_id)
  );
}

function renderFilters() {
  if (!filters) return;

  filters.innerHTML = `
    <button class="filter-btn active" data-filter="all">
      Tất cả
    </button>
    ${categories.map(category => `
      <button class="filter-btn" data-filter="${safe(categoryKey(category))}">
        ${safe(category.name)}
      </button>
    `).join("")}
  `;
}

function render() {
  const q = search.value.trim().toLocaleLowerCase("vi");

  const shown = products.filter(p => {
    const category = getCategory(p);
    const key = category ? categoryKey(category) : "";

    const matchesCategory =
      activeFilter === "all" || activeFilter === key;

    const text = `${p.name} ${p.description || ""} ${p.detail || ""}`
      .toLocaleLowerCase("vi");

    return matchesCategory && text.includes(q);
  });

  grid.innerHTML = shown.map(p => `
    <article class="product-card">
      <div class="product-visual">
        <img src="${safe(p.image_url || "assets/product-aov.jpg")}"
             alt="${safe(p.name)}" loading="lazy">
        <span class="game-icon">HN</span>
      </div>
      <div class="product-info">
        <h3>${safe(p.name)}</h3>
        <p>${safe(p.description || "")}</p>
        <a class="detail-btn" href="#" data-detail="${safe(p.id)}">
          Xem chi tiết <span>→</span>
        </a>
      </div>
    </article>
  `).join("");

  count.textContent =
    `${String(shown.length).padStart(2, "0")} SẢN PHẨM`;

  empty.hidden = shown.length !== 0;
}

async function loadProducts() {
  grid.innerHTML = "<p>Đang tải sản phẩm...</p>";

  try {
    const [productResult, categoryResult] = await Promise.all([
      db.from("products")
        .select("id,name,description,detail,price,image_url,category_id,is_active,created_at")
        .eq("is_active", true)
        .order("created_at", { ascending: false }),

      db.from("categories")
        .select("id,name,slug")
        .order("name")
    ]);

    if (productResult.error) throw productResult.error;
    if (categoryResult.error) throw categoryResult.error;

    products = productResult.data || [];
    categories = categoryResult.data || [];

    renderFilters();
    render();

  } catch (error) {
    console.error("Lỗi tải sản phẩm:", error);
    grid.innerHTML =
      "<p>Không tải được sản phẩm. Vui lòng thử lại.</p>";
    count.textContent = "LỖI TẢI DỮ LIỆU";
  }
}

if (filters) {
  filters.addEventListener("click", event => {
    const btn = event.target.closest(".filter-btn");
    if (!btn) return;

    filters.querySelector(".filter-btn.active")
      ?.classList.remove("active");

    btn.classList.add("active");
    activeFilter = btn.dataset.filter;
    render();
  });
}

search.addEventListener("input", render);

function closeModal() {
  modal.classList.remove("show");
  modal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

grid.addEventListener("click", event => {
  const link = event.target.closest("[data-detail]");
  if (!link) return;

  event.preventDefault();

  const product = products.find(
    p => String(p.id) === link.dataset.detail
  );

  if (!product) return;

  document.getElementById("modalImage").src =
    product.image_url || "assets/product-aov.jpg";

  document.getElementById("modalImage").alt = product.name;
  document.getElementById("modalTitle").textContent = product.name;
  document.getElementById("modalDescription").textContent =
    product.detail || product.description || "";

  selectedProduct = product;
  const buyButton = document.getElementById("buyButton");
  buyButton.href = "#";
  buyButton.target = "_self";
  buyButton.textContent = "Mua key • " + Number(product.price || 0).toLocaleString("vi-VN") + " đ →";
  document.getElementById("modalPrice").textContent = Number(product.price || 0).toLocaleString("vi-VN") + " đ";

  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
});

document.getElementById("modalClose")
  .addEventListener("click", closeModal);

modal.addEventListener("click", event => {
  if (event.target === modal) closeModal();
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape") closeModal();
});

const toggle = document.getElementById("menuToggle");
const nav = document.getElementById("navMenu");

toggle.addEventListener("click", () => {
  const open = nav.classList.toggle("open");
  toggle.setAttribute("aria-expanded", String(open));
});

nav.querySelectorAll("a").forEach(link => {
  link.addEventListener("click", () => {
    nav.classList.remove("open");
    toggle.setAttribute("aria-expanded", "false");
  });
});

document.getElementById("year").textContent =
  new Date().getFullYear();


/* TÀI KHOẢN KHÁCH HÀNG */
const accountModal = document.getElementById("accountModal");
const accountMessage = document.getElementById("accountMessage");
function showAccount() {
  accountModal.classList.add("show");
  accountModal.setAttribute("aria-hidden","false");
  document.body.style.overflow = "hidden";
  refreshAccountUI();
}
function hideAccount() {
  accountModal.classList.remove("show");
  accountModal.setAttribute("aria-hidden","true");
  document.body.style.overflow = "";
}
async function customerLoginId(value) {
  const username = String(value || "").trim().normalize("NFC");
  const normalized = username.toLocaleLowerCase("vi");
  // Giữ nguyên cách ánh xạ cũ để tài khoản chữ/số đã tạo trước đây vẫn đăng nhập được.
  if (normalized.includes("@")) return normalized;
  if (/^[a-z0-9._-]{3,24}$/.test(normalized)) return normalized + "@hnshop-user.com";
  // Tên tự do (có dấu cách, tiếng Việt, ký tự đặc biệt) được ánh xạ ổn định sang email nội bộ hợp lệ.
  const bytes = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest)).map(x => x.toString(16).padStart(2, "0")).join("");
  return "u" + hash.slice(0, 40) + "@hnshop-user.com";
}
function refreshAccountUI() {
  const logged = !!currentUser;
  const displayAccount = currentUser?.user_metadata?.username || currentUser?.email || "";
  document.getElementById("accountState").textContent = logged
    ? "Đã đăng nhập: " + displayAccount
    : "Đăng nhập hoặc tạo tài khoản để tiếp tục mua key.";
  document.getElementById("accountLogin").hidden = logged;
  document.getElementById("accountSignup").hidden = logged;
  document.getElementById("accountLogout").hidden = !logged;
  document.getElementById("accountEmail").hidden = logged;
  document.getElementById("accountPassword").hidden = logged;
}
async function syncCustomerSession() {
  const {data,error} = await db.auth.getSession();
  if(error) throw error;
  currentUser = data.session?.user || null;
  refreshAccountUI();
}
document.getElementById("accountOpen").addEventListener("click",showAccount);
document.getElementById("accountClose").addEventListener("click",hideAccount);
accountModal.addEventListener("click",e=>{if(e.target===accountModal)hideAccount();});
document.getElementById("accountLogin").addEventListener("click",async()=>{
  const username=document.getElementById("accountEmail").value.trim().normalize("NFC");
  const password=document.getElementById("accountPassword").value;
  if(!username || Array.from(username).length>40) { accountMessage.textContent="Vui lòng nhập tên tài khoản (tối đa 40 ký tự)."; return; }
  if(!password) { accountMessage.textContent="Vui lòng nhập mật khẩu."; return; }
  accountMessage.textContent="Đang đăng nhập...";
  document.getElementById("accountLogin").disabled=true;
  try {
    const loginId=await customerLoginId(username);
    const {data,error}=await db.auth.signInWithPassword({email:loginId,password});
    if(error) throw error;
    currentUser=data.user;
    accountMessage.textContent="Đăng nhập thành công.";
    refreshAccountUI();
    if (pendingPurchase) { const p = pendingPurchase; pendingPurchase = null; await createCustomerOrder(p); }
  } catch(e) { accountMessage.textContent="Không đăng nhập được: "+(e.message||e); }
  finally { document.getElementById("accountLogin").disabled=false; }
});
document.getElementById("accountSignup").addEventListener("click",async()=>{
  const username=document.getElementById("accountEmail").value.trim().normalize("NFC");
  const password=document.getElementById("accountPassword").value;
  if(!username || Array.from(username).length>40) { accountMessage.textContent="Tên tài khoản không được để trống và tối đa 40 ký tự."; return; }
  if(username.includes("@")) { accountMessage.textContent="Tên tài khoản không cần nhập email hoặc ký tự @."; return; }
  if(password.length<6) { accountMessage.textContent="Mật khẩu cần ít nhất 6 ký tự."; return; }
  accountMessage.textContent="Đang tạo tài khoản...";
  document.getElementById("accountSignup").disabled=true;
  try {
    const loginId=await customerLoginId(username);
    const {data,error}=await db.auth.signUp({email:loginId,password,options:{data:{username}}});
    if(error) throw error;
    if(data.session) {
      currentUser=data.user;
      accountMessage.textContent="Tạo tài khoản thành công và đã đăng nhập.";
      refreshAccountUI();
      if (pendingPurchase) { const p = pendingPurchase; pendingPurchase = null; await createCustomerOrder(p); }
    } else {
      accountMessage.textContent="Tài khoản đã được tạo nhưng Supabase đang yêu cầu xác nhận email. Admin cần tắt Confirm email trong Authentication → Providers → Email.";
    }
  } catch(e) { accountMessage.textContent="Không tạo được tài khoản: "+(e.message||e); }
  finally { document.getElementById("accountSignup").disabled=false; }
});
document.getElementById("accountLogout").addEventListener("click",async()=>{
  const {error}=await db.auth.signOut();
  if(error) { accountMessage.textContent="Không đăng xuất được: "+error.message; return; }
  currentUser=null;
  accountMessage.textContent="Đã đăng xuất.";
  refreshAccountUI();
});
document.getElementById("buyButton").addEventListener("click", async e => {
  e.preventDefault();
  if (!selectedProduct) return;
  closeModal();
  if (!currentUser) { pendingPurchase = selectedProduct; showAccount(); accountMessage.textContent = "Hãy đăng nhập hoặc tạo tài khoản để tiếp tục đặt hàng."; return; }
  showAccount();
  await createCustomerOrder(selectedProduct);
});
db.auth.onAuthStateChange((_event,session)=>{
  currentUser=session?.user||null;
  refreshAccountUI();
});
syncCustomerSession().catch(e=>console.error("Lỗi kiểm tra tài khoản",e));


/* CHECKOUT VÀ LỊCH SỬ KEY */
function moneyVND(value) { return Number(value || 0).toLocaleString("vi-VN") + " đ"; }
async function randomAccessHash() {
  const bytes = new Uint8Array(32); crypto.getRandomValues(bytes);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map(x => x.toString(16).padStart(2, "0")).join("");
}
function purchaseMessage(html) { document.getElementById("purchasePanel").innerHTML = html; }
async function createCustomerOrder(product) {
  try {
    if (!currentUser) throw new Error("Vui lòng đăng nhập trước khi đặt hàng.");
    if (!product || Number(product.price) <= 0) throw new Error("Sản phẩm chưa có giá hợp lệ.");
    accountMessage.textContent = "Đang tạo đơn hàng..."; purchaseMessage("");
    const hash = await randomAccessHash();
    const created = await db.rpc("create_store_order", {p_items:[{product_id:Number(product.id),quantity:1}],p_access_token_hash:hash});
    if (created.error) throw created.error;
    const detail = await db.rpc("get_store_order", {p_access_token_hash:hash});
    if (detail.error) throw detail.error;
    const order = Array.isArray(detail.data) ? detail.data[0] : detail.data;
    if (!order || !order.id) throw new Error("Đơn đã tạo nhưng chưa đọc được chi tiết. Hãy kiểm tra lịch sử mua hàng.");
    const setting = await db.from("payment_settings").select("qr_image_url").eq("id",1).maybeSingle();
    const qrUrl = !setting.error && setting.data ? setting.data.qr_image_url || "" : "";
    accountMessage.textContent = "Đơn hàng đã được tạo. Chuyển khoản đúng nội dung bên dưới.";
    purchaseMessage('<div class="purchase-card"><h3>Đơn hàng của bạn</h3><p><b>Mã đơn:</b> '+safe(order.id)+'</p><p><b>Số tiền:</b> '+moneyVND(order.total)+'</p><p><b>Nội dung chuyển khoản:</b></p><div class="transfer-note">'+safe(order.transfer_note || "")+'</div>'+(qrUrl?'<img class="payment-qr" src="'+safe(qrUrl)+'" alt="QR thanh toán HNShop">':'<p class="purchase-warning">Admin chưa cài ảnh QR thanh toán. Vui lòng liên hệ HNShop trước khi chuyển khoản.</p>')+'<p class="purchase-warning">Đơn chỉ được xử lý sau khi Admin kiểm tra giao dịch MB Bank.</p><button type="button" class="buy-button" id="refreshMyOrders">Xem lịch sử mua hàng</button></div>');
    document.getElementById("refreshMyOrders").addEventListener("click",loadMyOrders);
  } catch(e) { accountMessage.textContent = "Không tạo được đơn hàng: " + (e.message || e); }
}
async function loadMyOrders() {
  const panel = document.getElementById("purchasePanel"); panel.innerHTML = "<p>Đang tải lịch sử mua hàng...</p>";
  try {
    const result = await db.rpc("get_my_store_orders"); if (result.error) throw result.error;
    const orders = Array.isArray(result.data) ? result.data : [];
    if (!orders.length) { panel.innerHTML='<div class="purchase-card"><h3>Lịch sử mua hàng</h3><p>Bạn chưa có đơn hàng nào.</p></div>'; return; }
    let html='<div class="purchase-card"><h3>Lịch sử mua hàng</h3>';
    orders.forEach(o => {
      html+='<div class="history-order"><p><b>Mã đơn:</b> '+safe(o.id)+'</p><p><b>Ngày tạo:</b> '+safe(new Date(o.created_at).toLocaleString("vi-VN"))+'</p><p><b>Tổng tiền:</b> '+moneyVND(o.total)+'</p><p><b>Trạng thái:</b> '+safe(o.status)+'</p>';
      if(o.status==="pending") html+='<p class="purchase-warning">Đang chờ Admin xác nhận thanh toán.</p>';
      (o.items||[]).forEach(item => {
        html+='<div class="history-item"><b>'+safe(item.product_name)+' × '+safe(item.quantity)+'</b>';
        if(item.keys&&item.keys.length) html+='<p>Key đã cấp:</p>'+item.keys.map(k=>'<code class="customer-key">'+safe(k)+'</code>').join("");
        else html+='<p class="purchase-warning">Key sẽ hiển thị tại đây sau khi Admin xác nhận đã nhận tiền.</p>';
        html+='</div>';
      });
      html+='</div>';
    });
    panel.innerHTML=html+'</div>';
  } catch(e) { panel.innerHTML='<p class="purchase-warning">Không tải được lịch sử: '+safe(e.message||e)+'</p>'; }
}
document.getElementById("accountHistory").addEventListener("click",loadMyOrders);

loadProducts();
