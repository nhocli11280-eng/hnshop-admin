
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

  const buyButton = document.getElementById("buyButton");
  buyButton.href = "#";
  buyButton.target = "_self";
  buyButton.textContent = "Đăng nhập để mua key →";

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
function refreshAccountUI() {
  const logged = !!currentUser;
  document.getElementById("accountState").textContent = logged
    ? "Đã đăng nhập: " + currentUser.email
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
  const email=document.getElementById("accountEmail").value.trim();
  const password=document.getElementById("accountPassword").value;
  accountMessage.textContent="Đang đăng nhập...";
  try {
    const {data,error}=await db.auth.signInWithPassword({email,password});
    if(error) throw error;
    currentUser=data.user;
    accountMessage.textContent="Đăng nhập thành công.";
    refreshAccountUI();
  } catch(e) { accountMessage.textContent="Không đăng nhập được: "+(e.message||e); }
});
document.getElementById("accountSignup").addEventListener("click",async()=>{
  const email=document.getElementById("accountEmail").value.trim();
  const password=document.getElementById("accountPassword").value;
  if(!email) { accountMessage.textContent="Vui lòng nhập email."; return; }
  if(password.length<6) { accountMessage.textContent="Mật khẩu cần ít nhất 6 ký tự."; return; }
  accountMessage.textContent="Đang tạo tài khoản...";
  try {
    const {data,error}=await db.auth.signUp({email,password});
    if(error) throw error;
    if(data.session) {
      currentUser=data.user;
      accountMessage.textContent="Tạo tài khoản thành công và đã đăng nhập.";
      refreshAccountUI();
    } else {
      accountMessage.textContent="Đã tạo tài khoản. Hãy kiểm tra email để xác nhận, sau đó đăng nhập.";
    }
  } catch(e) { accountMessage.textContent="Không tạo được tài khoản: "+(e.message||e); }
});
document.getElementById("accountLogout").addEventListener("click",async()=>{
  const {error}=await db.auth.signOut();
  if(error) { accountMessage.textContent="Không đăng xuất được: "+error.message; return; }
  currentUser=null;
  accountMessage.textContent="Đã đăng xuất.";
  refreshAccountUI();
});
document.getElementById("buyButton").addEventListener("click",e=>{
  e.preventDefault();
  closeModal();
  showAccount();
  accountMessage.textContent=currentUser
    ? "Bạn đã đăng nhập. Phần đặt hàng và thanh toán sẽ được nối tiếp ở bước kế tiếp."
    : "Hãy đăng nhập hoặc tạo tài khoản trước khi mua key.";
});
db.auth.onAuthStateChange((_event,session)=>{
  currentUser=session?.user||null;
  refreshAccountUI();
});
syncCustomerSession().catch(e=>console.error("Lỗi kiểm tra tài khoản",e));

loadProducts();
