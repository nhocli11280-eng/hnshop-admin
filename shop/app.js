
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
let productPackages = [];
let activeFilter = "all";
let currentUser = null;
let selectedProduct = null;
let selectedPackage = null;
let pendingPurchase = null;
let paymentCountdownInterval = null;

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
        ${p.logo_url ? `<img class="product-logo" src="${safe(p.logo_url)}" alt="Logo ${safe(p.name)}" loading="lazy">` : '<span class="game-icon">HN</span>'}
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
    const [productResult, categoryResult, packageResult] = await Promise.all([
      db.from("products")
        .select("id,name,description,detail,price,image_url,logo_url,category_id,is_active,created_at")
        .eq("is_active", true)
        .order("created_at", { ascending: false }),

      db.from("categories")
        .select("id,name,slug")
        .order("name"),

      db.from("product_packages")
        .select("id,product_id,name,price,is_active,sort_order")
        .order("sort_order")
    ]);

    if (productResult.error) throw productResult.error;
    if (categoryResult.error) throw categoryResult.error;
    if (packageResult.error) throw packageResult.error;

    products = productResult.data || [];
    categories = categoryResult.data || [];
    productPackages = packageResult.data || [];
    products.forEach(p => {
      p.packages = productPackages.filter(x => String(x.product_id) === String(p.id));
    });

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
  const packageSelect = document.getElementById("packageSelect");
  const availablePackages = product.packages || [];
  selectedPackage = availablePackages[0] || null;
  packageSelect.innerHTML = availablePackages.map(p =>
    '<option value="' + safe(p.id) + '">' + safe(p.name) + ' — ' +
    Number(p.price || 0).toLocaleString("vi-VN") + ' đ</option>'
  ).join("");
  packageSelect.disabled = availablePackages.length === 0;
  const updatePackagePrice = () => {
    selectedPackage = availablePackages.find(p => String(p.id) === packageSelect.value) || null;
    const price = selectedPackage ? Number(selectedPackage.price || 0) : Number(product.price || 0);
    document.getElementById("modalPrice").textContent = price.toLocaleString("vi-VN") + " đ";
    const buyButton = document.getElementById("buyButton");
    buyButton.textContent = "Mua key • " + price.toLocaleString("vi-VN") + " đ →";
  };
  packageSelect.onchange = updatePackagePrice;
  updatePackagePrice();
  const buyButton = document.getElementById("buyButton");
  buyButton.href = "#";
  buyButton.target = "_self";

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

let accessCheckPromise = null;
let shopAccessBlocked = false;
async function enforceShopAccess() {
  if (shopAccessBlocked) return false;
  if (!currentUser) return true;
  if (accessCheckPromise) return accessCheckPromise;
  accessCheckPromise = (async () => {
    const {data,error}=await db.rpc("check_shop_customer_access");
    if(error) {
      console.warn("Không kiểm tra được quyền shop:",error.message);
      return false;
    }
    if(data === false) {
      shopAccessBlocked = true;
      pendingPurchase = null;
      closeModal();
      closeGame();
      await db.auth.signOut();
      currentUser = null;
      refreshAccountUI();
      purchaseMessage('<p class="purchase-warning">Tài khoản đã bị Admin kích khỏi HNShop. Toàn bộ dịch vụ mua key, nạp ví, vòng quay, túi mù và lịch sử đều bị khóa. Chỉ có thể sử dụng lại khi Admin mở khóa hoặc đăng ký tài khoản mới.</p>');
      accountMessage.textContent = "Tài khoản đã bị kích khỏi Shop. Vui lòng đăng ký tài khoản mới hoặc chờ Admin mở khóa.";
      showAccount();
      return false;
    }
    return true;
  })();
  try { return await accessCheckPromise; }
  finally { accessCheckPromise = null; }
}
async function registerShopCustomer() {
  if(!currentUser) return;
  const {data,error}=await db.rpc("register_shop_customer",{
    p_username:currentUser.user_metadata?.username || currentUser.email || "Khách hàng"
  });
  if(error) { console.warn("Không ghi nhận được tài khoản:",error.message); return; }
  if(data === false) await enforceShopAccess();
}

document.getElementById("accountOpen").addEventListener("click",showAccount);
document.getElementById("historyOpen").addEventListener("click",()=>{ showAccount(); if(currentUser) loadMyOrders(); else accountMessage.textContent="Đăng nhập để xem lịch sử mua hàng."; });
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
  if(session?.user) setTimeout(()=>registerShopCustomer(),0);
});
syncCustomerSession().then(()=>{if(currentUser) registerShopCustomer();}).catch(e=>console.error("Lỗi kiểm tra tài khoản",e));
setInterval(()=>{if(currentUser) enforceShopAccess();},1000);\ndocument.addEventListener("visibilitychange",()=>{if(!document.hidden && currentUser) enforceShopAccess();});\nwindow.addEventListener("focus",()=>{if(currentUser) enforceShopAccess();});


/* CHECKOUT VÀ LỊCH SỬ KEY */
function moneyVND(value) { return Number(value || 0).toLocaleString("vi-VN") + " đ"; }
async function randomAccessHash() {
  const bytes = new Uint8Array(32); crypto.getRandomValues(bytes);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map(x => x.toString(16).padStart(2, "0")).join("");
}
function purchaseMessage(html) { document.getElementById("purchasePanel").innerHTML = html; }
function formatPurchaseDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Không rõ" : date.toLocaleString("vi-VN", {day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false});
}
function packageDays(name) {
  const match = String(name || "").match(/(\d+)\s*(?:ngày|day|days|d)\b/i);
  return match ? Number(match[1]) : null;
}
function startPaymentCountdown(createdAt) {
  if (paymentCountdownInterval) clearInterval(paymentCountdownInterval);
  const created = new Date(createdAt || Date.now()).getTime();
  const expiresAt = (Number.isFinite(created) ? created : Date.now()) + 10 * 60 * 1000;
  const tick = () => {
    const node = document.getElementById("paymentCountdown");
    if (!node) { clearInterval(paymentCountdownInterval); paymentCountdownInterval = null; return; }
    const remaining = Math.max(0, expiresAt - Date.now());
    node.textContent = String(Math.floor(remaining / 60000)).padStart(2,"0") + ":" + String(Math.floor((remaining % 60000) / 1000)).padStart(2,"0");
    const note = document.getElementById("paymentCountdownNote");
    if (remaining <= 0) {
      node.classList.add("countdown-expired");
      if (note) note.textContent = "Đã hết 10 phút giữ thông tin thanh toán. Đơn vẫn chờ Admin kiểm tra; vui lòng liên hệ shop nếu bạn đã chuyển khoản.";
      clearInterval(paymentCountdownInterval); paymentCountdownInterval = null;
    } else if (note) note.textContent = "Vui lòng hoàn tất chuyển khoản trong thời gian này.";
  };
  tick(); paymentCountdownInterval = setInterval(tick,1000);
}
async function createCustomerOrder(product) {
  try {
    if (!currentUser) throw new Error("Vui lòng đăng nhập trước khi đặt hàng.");
    if (!(await enforceShopAccess())) throw new Error("Tài khoản đã bị khóa khỏi shop.");
    if (!product || !selectedPackage || Number(selectedPackage.price) <= 0) throw new Error("Vui lòng chọn gói key có giá hợp lệ.");
    accountMessage.textContent = "Đang tạo đơn hàng..."; purchaseMessage("");
    const hash = await randomAccessHash();
    const created = await db.rpc("create_store_order", {p_items:[{product_id:Number(product.id),package_id:selectedPackage.id,quantity:1}],p_access_token_hash:hash});
    if (created.error) throw created.error;
    const detail = await db.rpc("get_store_order", {p_access_token_hash:hash});
    if (detail.error) throw detail.error;
    const order = Array.isArray(detail.data) ? detail.data[0] : detail.data;
    if (!order || !order.id) throw new Error("Đơn đã tạo nhưng chưa đọc được chi tiết. Hãy kiểm tra lịch sử mua hàng.");
    const setting = await db.from("payment_settings").select("qr_image_url").eq("id",1).maybeSingle();
    const qrUrl = !setting.error && setting.data ? setting.data.qr_image_url || "" : "";
    accountMessage.textContent = "Đơn hàng đã được tạo. Chuyển khoản đúng nội dung bên dưới.";
    purchaseMessage('<div class="purchase-card"><h3>Đơn hàng của bạn</h3><p><b>Mã đơn:</b> '+safe(order.id)+'</p><p><b>Ngày giờ tạo đơn:</b> '+safe(formatPurchaseDate(order.created_at || new Date().toISOString()))+'</p><p><b>Số tiền:</b> '+moneyVND(order.total)+'</p><div class="payment-countdown"><span>Thời gian thanh toán còn lại</span><strong id="paymentCountdown">10:00</strong><small id="paymentCountdownNote">Vui lòng hoàn tất chuyển khoản trong thời gian này.</small></div><p><b>Nội dung chuyển khoản:</b></p><div class="transfer-note">'+safe(order.transfer_note || "")+'</div>'+(qrUrl?'<img class="payment-qr" src="'+safe(qrUrl)+'" alt="QR thanh toán HNShop">':'<p class="purchase-warning">Admin chưa cài ảnh QR thanh toán. Vui lòng liên hệ HNShop trước khi chuyển khoản.</p>')+'<p class="purchase-warning">Đơn chỉ được xử lý sau khi Admin kiểm tra giao dịch MB Bank. Đồng hồ 10 phút chỉ nhắc thời gian thanh toán, không tự hủy đơn.</p><button type="button" class="buy-button" id="refreshMyOrders">Xem lịch sử mua hàng</button></div>');
    startPaymentCountdown(order.created_at || new Date().toISOString());
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
      html+='<div class="history-order"><p><b>Mã đơn:</b> '+safe(o.id)+'</p><p><b>Ngày giờ mua:</b> '+safe(formatPurchaseDate(o.created_at))+'</p><p><b>Tổng số tiền:</b> '+moneyVND(o.total)+'</p><p><b>Trạng thái:</b> '+safe(o.status)+'</p>';
      if(o.status==="pending") html+='<p class="purchase-warning">Đang chờ Admin xác nhận thanh toán.</p>';
      (o.items||[]).forEach(item => {
        const days = packageDays(item.package_name);
        const lineTotal = Number(item.price || 0) * Number(item.quantity || 1);
        html+='<div class="history-item"><b>'+safe(item.product_name)+' — '+safe(item.package_name || "Gói key")+' × '+safe(item.quantity)+'</b><p><b>Thời hạn:</b> '+(days ? safe(days)+" ngày" : "Chưa ghi rõ số ngày trong tên gói")+'</p><p><b>Thành tiền:</b> '+moneyVND(lineTotal)+'</p>';
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

async function loadShopBrand() {
  try {
    const { data, error } = await db.from("payment_settings")
      .select("shop_name,logo_image_url").eq("id", 1).maybeSingle();
    if (error) throw error;
    const name = String(data?.shop_name || "HNShop").trim() || "HNShop";
    document.getElementById("brandName").textContent = name;
    document.title = name + " — Digital Game Store";
    const logo = document.getElementById("brandLogo");
    const mark = document.getElementById("brandMark");
    if (data?.logo_image_url) {
      logo.src = data.logo_image_url;
      logo.style.display = "block";
      mark.style.display = "none";
    }
  } catch (error) {
    console.warn("Không tải được tên/logo shop:", error);
  }
}


/* VÒNG QUAY & TÚI MÙ - kết quả và trừ ví do Supabase xử lý */
const gameModal=document.getElementById("gameModal");
let activeGame="wheel",gameBusy=false,wheelRotation=0,shopGameConfig=null;
function closeGame(){gameModal.classList.remove("show");gameModal.setAttribute("aria-hidden","true");document.body.style.overflow="";}
async function refreshGameWallet(){
 const node=document.getElementById("gameWallet");
 if(!currentUser){node.textContent="Đăng nhập để xem ví";return;}
 node.textContent="Đang tải...";
 const {data,error}=await db.rpc("shop_game_wallet_balance");
 if(error){node.textContent="Chưa sẵn sàng";document.getElementById("gameResult").textContent="Ví chưa được khởi tạo. Admin cần chạy SQL trò chơi.";return;}
 node.textContent=moneyVND(data);
}


async function loadTopupPaymentInfo(){
 const node=document.getElementById("topupPaymentInfo");
 if(!node)return;
 try{
  const {data,error}=await db.from("payment_settings").select("qr_image_url").eq("id",1).maybeSingle();
  if(error)throw error;
  const qr=data?.qr_image_url||"";
  node.innerHTML=qr
   ? "<b>Thông tin thanh toán HNShop</b><img class='topup-payment-qr' src='"+safe(qr)+"' alt='QR chuyển khoản dùng chung với đơn mua hàng'><small>Quét mã QR này để nạp ví hoặc thanh toán đơn mua hàng.</small>"
   : "<b>Thông tin thanh toán HNShop</b><p>Chưa có ảnh QR thanh toán. Vui lòng liên hệ shop trước khi chuyển khoản.</p>";
 }catch(e){node.textContent="Không tải được thông tin thanh toán: "+(e.message||e);}
}
let topupCountdownInterval=null;
function renderTopupCountdown(expiresAt){
 if(topupCountdownInterval)clearInterval(topupCountdownInterval);
 const tick=()=>{
  const node=document.getElementById("topupCountdown");
  if(!node){clearInterval(topupCountdownInterval);topupCountdownInterval=null;return;}
  const left=Math.max(0,new Date(expiresAt).getTime()-Date.now());
  node.textContent=String(Math.floor(left/60000)).padStart(2,"0")+":"+String(Math.floor(left%60000/1000)).padStart(2,"0");
  const note=document.getElementById("topupCountdownNote");
  if(note)note.textContent=left>0?"Vui lòng chuyển khoản trong 10 phút. Sau khi chuyển, đơn vẫn chờ Admin xác nhận.":"Đã hết 10 phút hiển thị. Nếu đã chuyển khoản, đơn vẫn chờ Admin kiểm tra.";
  if(left<=0){clearInterval(topupCountdownInterval);topupCountdownInterval=null;}
 };
 tick();topupCountdownInterval=setInterval(tick,1000);
}
async function showTopupPaymentOrder(order){
 const node=document.getElementById("topupPaymentInfo");
 const {data,error}=await db.from("payment_settings").select("qr_image_url").eq("id",1).maybeSingle();
 if(error)throw error;
 const qr=data?.qr_image_url||"";
 node.innerHTML="<b>Đơn nạp ví #"+safe(order.id)+" · "+moneyVND(order.amount)+"</b>"+
  (qr?"<img class='topup-payment-qr' src='"+safe(qr)+"' alt='QR thanh toán HNShop'>":"<p>Admin chưa cài ảnh QR thanh toán.</p>")+
  "<small>Nội dung chuyển khoản bắt buộc:</small><div class='transfer-note'>"+safe(order.transfer_note||"")+"</div>"+
  "<div class='payment-countdown'><span>Thời gian thanh toán còn lại</span><strong id='topupCountdown'>10:00</strong><small id='topupCountdownNote'>Vui lòng chuyển khoản trong 10 phút.</small></div>"+
  "<small>Chuyển khoản xong, đơn sẽ xuất hiện trong Quản lý đơn hàng. Ví chỉ được cộng sau khi Admin xác nhận.</small>";
 renderTopupCountdown(order.expires_at||new Date(new Date(order.created_at).getTime()+600000).toISOString());
}
async function loadMyWalletTopups(){
 const list=document.getElementById("myTopups");
 if(!currentUser){list.textContent="Đăng nhập để xem yêu cầu nạp.";return [];}
 list.textContent="Đang tải lịch sử nạp...";
 const {data,error}=await db.rpc("shop_list_my_wallet_topups");
 if(error){list.textContent="Không tải được lịch sử nạp: "+error.message;return [];}
 const rows=data||[],status={pending:"Đang chờ Admin xác nhận",approved:"Đã cộng tiền vào ví",rejected:"Đã từ chối"};
 list.innerHTML="<h4>Lịch sử nạp ví</h4>"+(rows.length?rows.map(x=>"<div class='topup-history'><b>Đơn nạp ví #"+x.id+" · "+moneyVND(x.amount)+"</b><span>"+safe(status[x.status]||x.status)+"</span><small>"+new Date(x.created_at).toLocaleString("vi-VN")+"</small><small>Nội dung CK: "+safe(x.transfer_note||"")+"</small>"+(x.note?"<small>Ghi chú: "+safe(x.note)+"</small>":"")+(x.admin_note?"<small>Admin: "+safe(x.admin_note)+"</small>":"")+"</div>").join(""):"<p>Chưa có đơn nạp ví. Nhập số tiền và bấm TẠO ĐƠN để nhận QR, nội dung CK và đồng hồ 10 phút.</p>");
 return rows;
}
document.getElementById("submitTopup").addEventListener("click",async()=>{
 const btn=document.getElementById("submitTopup"),msg=document.getElementById("topupMessage");
 if(!currentUser){msg.textContent="Vui lòng đăng nhập trước khi nạp ví.";return;}
 const amount=Number(document.getElementById("topupAmount").value);
 const note=document.getElementById("topupNote").value.trim();
 if(!Number.isInteger(amount)||amount<10000||amount>10000000){msg.textContent="Số tiền nạp từ 10.000 đến 10.000.000đ.";return;}
 btn.disabled=true;msg.textContent="Đang gửi yêu cầu...";
 try{
  const {data,error}=await db.rpc("shop_request_wallet_topup",{p_amount:amount,p_note:note});
  if(error)throw error;
  msg.textContent="Đã tạo đơn nạp ví #"+data+". Hãy chuyển khoản đúng nội dung tự động bên dưới; ví chưa được cộng tiền.";
  const {data:rows,error:detailError}=await db.rpc("shop_list_my_wallet_topups");
  if(detailError)throw detailError;
  const created=(rows||[]).find(x=>String(x.id)===String(data));
  if(!created)throw new Error("Đơn đã tạo nhưng chưa tải được thông tin thanh toán.");
  document.getElementById("topupAmount").value="";
  document.getElementById("topupNote").value="";
  await showTopupPaymentOrder(created);
  await loadMyWalletTopups();
 }catch(e){msg.textContent="Không gửi được: "+(e.message||e);}
 finally{btn.disabled=false;}
});

function renderGameConfigForActive(){
 const cfg=shopGameConfig||{},isWheel=activeGame==='wheel';
 const prizes=Array.isArray(isWheel?cfg.wheel_prizes:cfg.blindbox_prizes)?(isWheel?cfg.wheel_prizes:cfg.blindbox_prizes):(cfg.prizes||[]);
 const cost=Number(isWheel?cfg.wheel_cost:cfg.blindbox_cost)||15000;
 const wheel=document.getElementById("prizeWheel");
 if(wheel&&prizes.length){
  wheel.innerHTML=prizes.map(p=>"<span>"+safe(p.label)+"<br>"+(Number(p.weight)/100)+"%</span>").join("");
  const colors=["#153b68","#0b6f83","#6845a0","#a34b73","#287a66","#9b6a2d"];
  let acc=0;const parts=prizes.map((p,i)=>{const from=acc/100;acc+=Number(p.weight);return colors[i%colors.length]+" "+from+"% "+(acc/100)+"%";});
  wheel.style.background="conic-gradient("+parts.join(",")+")";
 }
 const odds=document.querySelector(".game-odds");
 if(odds&&prizes.length)odds.textContent="Phần thưởng có thể nhận: "+prizes.filter(p=>Number(p.weight)>0).map(p=>p.label+" "+(Number(p.weight)/100)+"%").join(" · ");
 const play=document.getElementById("gamePlay");
 if(play)play.textContent=(isWheel?"QUAY":"MỞ TÚI")+" • "+moneyVND(cost);
 const desc=document.getElementById("gameResult");
 if(desc)desc.textContent="Mỗi "+(isWheel?"lượt quay":"lần mở túi")+" trừ "+moneyVND(cost)+" từ ví. Kết quả do hệ thống xác định.";
}
async function loadShopGameConfig(){
 try{
  const {data,error}=await db.rpc("shop_get_game_config");if(error)throw error;
  shopGameConfig=typeof data==="string"?JSON.parse(data):data;
  renderGameConfigForActive();
  const wheelUrl=shopGameConfig?.wheel_image_url||"";
  const wheelCard=document.querySelector(".wheel-art"),wheelStage=document.getElementById("wheelStage");
  if(wheelUrl){if(wheelCard){wheelCard.style.backgroundImage="linear-gradient(#07142655,#07142655),url("+JSON.stringify(wheelUrl)+")";wheelCard.style.backgroundSize="cover";wheelCard.style.backgroundPosition="center";}if(wheelStage){wheelStage.style.backgroundImage="url("+JSON.stringify(wheelUrl)+")";wheelStage.classList.add("has-outer-image");}}
  else{if(wheelCard)wheelCard.style.backgroundImage="";if(wheelStage){wheelStage.style.backgroundImage="";wheelStage.classList.remove("has-outer-image");}}
  if(shopGameConfig?.blindbox_image_url){const box=document.querySelector(".blindbox-large"),blindCard=document.querySelector(".blind-art");if(box){box.style.backgroundImage="url("+JSON.stringify(shopGameConfig.blindbox_image_url)+")";box.classList.add("has-custom-image");}if(blindCard){blindCard.style.backgroundImage="linear-gradient(#07142655,#07142655),url("+JSON.stringify(shopGameConfig.blindbox_image_url)+")";blindCard.style.backgroundSize="cover";blindCard.style.backgroundPosition="center";}}
 }catch(e){console.warn("Không tải được cấu hình trò chơi",e);}
}

function openGame(type){
 activeGame=type==="blindbox"?"blindbox":"wheel";
 if(!currentUser){showAccount();accountMessage.textContent="Đăng nhập tài khoản khách hàng để tham gia trò chơi.";return;}
 document.getElementById("gameTitle").textContent=activeGame==="wheel"?"Vòng quay Key Chấp Tố Menu Tím":"Túi mù HNShop";
 document.getElementById("wheelStage").hidden=activeGame!=="wheel";
 document.getElementById("blindStage").hidden=activeGame!=="blindbox";
 document.getElementById("gamePlay").textContent=activeGame==="wheel"?"QUAY • 15.000 đ":"MỞ TÚI • 15.000 đ";
 renderGameConfigForActive();
 document.getElementById("prizeWheel").style.transform="rotate(0deg)";
 document.getElementById("blindStage").querySelector(".blindbox-large").classList.remove("opening");
 gameModal.classList.add("show");gameModal.setAttribute("aria-hidden","false");document.body.style.overflow="hidden";
 refreshGameWallet();
 loadMyWalletTopups().then(rows=>{
  const pending=(rows||[]).find(x=>x.status==="pending");
  if(pending) showTopupPaymentOrder(pending).catch(e=>{document.getElementById("topupPaymentInfo").textContent="Không tải được thông tin đơn nạp: "+(e.message||e);});
  else loadTopupPaymentInfo();
 });
 loadShopGameConfig();
}
document.querySelectorAll("[data-game]").forEach(btn=>btn.addEventListener("click",()=>openGame(btn.dataset.game)));
document.getElementById("gameClose").addEventListener("click",closeGame);
gameModal.addEventListener("click",e=>{if(e.target===gameModal)closeGame();});
document.getElementById("gamePlay").addEventListener("click",async()=>{
 if(gameBusy)return;
 if(!currentUser){closeGame();showAccount();accountMessage.textContent="Vui lòng đăng nhập trước khi chơi.";return;}
 gameBusy=true;const btn=document.getElementById("gamePlay");btn.disabled=true;
 const resultNode=document.getElementById("gameResult");resultNode.textContent="Đang xác định phần thưởng...";
 const wheel=document.getElementById("prizeWheel");const box=document.querySelector(".blindbox-large");
 if(activeGame==="wheel"){wheelRotation+=1800+Math.floor(Math.random()*360);wheel.style.transform="rotate("+wheelRotation+"deg)";}
 else box.classList.add("opening");
 try{
  const {data,error}=await db.rpc("shop_play_game",{p_game_type:activeGame});
  if(error)throw error;
  const prize=typeof data==="string"?JSON.parse(data):data;
  await new Promise(resolve=>setTimeout(resolve,activeGame==="wheel"?4100:1300));
  if(activeGame==="blindbox")box.classList.remove("opening");
  resultNode.innerHTML="🎉 Bạn nhận được: <b>"+safe(prize.prize_label)+"</b>"+(prize.key_value?"<br><code class='customer-key'>"+safe(prize.key_value)+"</code>":"") ;
  document.getElementById("gameWallet").textContent=moneyVND(prize.balance);
 }catch(e){
  if(activeGame==="blindbox")box.classList.remove("opening");
  resultNode.textContent="Không thể chơi: "+(e.message||e);
  await refreshGameWallet();
 }finally{gameBusy=false;btn.disabled=false;}
});

loadProducts();
loadShopBrand();
loadShopGameConfig();
