/**
 * The fixture site: "Northwind Supply", a small storefront.
 *
 * Chosen to exercise the parts of the schema that carry risk, not to be pretty:
 *   - a `/product/:id` pattern captured at two instances and two viewports
 *     (decision 0002's composite route id);
 *   - a ProductCard subtree repeated three times with varying leaf text, which
 *     is exactly §7.2's component-extraction signal;
 *   - an open shadow root (§11) and a third-party iframe (§11);
 *   - `[aria-expanded]` and `[data-state]` hooks so states.json has real CSSOM rules;
 *   - an auth-gated route that redirects anonymously (§6, M6).
 */
import { el, txt, sha256, short12 } from './lib-dom.mjs';

export const SITE_ID = 'northwind-supply';
export const ORIGIN = 'https://example.com';

/** Content addresses. Fixture bytes do not exist; the ids are stable hashes of labels. */
const asset = (label) => sha256(`northwind-asset:${label}`);
export const ASSET = {
  logo: asset('logo.svg'),
  appCss: asset('app.css'),
  fontSohne: asset('sohne-buch.woff2'),
  imgMug: asset('mug-blue.jpg'),
  imgNotebook: asset('notebook-a5.jpg'),
  imgPens: asset('pens-fine.jpg'),
  reviewsPlaceholder: asset('reviews-placeholder.png'),
  texture: asset('paper-texture.png'),
};

const gap = (label) => `gap_${short12(`northwind-gap:${label}`)}`;
export const GAP = {
  thirdPartyIframe: gap('third-party-iframe-reviews'),
  licensedFont: gap('licensed-font-sohne'),
  destructiveSkip: gap('destructive-delete-account'),
  /** Infer-stage: the skipped control was bound to a URL and synthesized. */
  boundDelete: gap('bound-delete-account-endpoint'),
  /** A narrowed field type, review-required (§7). */
  narrowedOrderStatus: gap('narrowed-order-status-enum'),
  /** A control that was fired and would not resolve — 0024 §3, and its diagnostic. */
  undriveableControl: gap('undriveable-quick-filter'),
  thirdPartyOrigin: gap('third-party-origin-widgets'),
  closedShadowRoot: gap('closed-shadow-root-nw-rating'),
};

export const PRODUCTS = [
  { sku: 'MUG-BLUE-12OZ', slug: 'mug-blue-12oz', title: 'Blue Enamel Mug, 12oz', price: '$18.00', image: '/static/img/mug-blue.jpg', assetId: ASSET.imgMug },
  { sku: 'NB-A5-DOT', slug: 'notebook-a5-dot', title: 'A5 Dot-Grid Notebook', price: '$12.50', image: '/static/img/notebook-a5.jpg', assetId: ASSET.imgNotebook },
  { sku: 'PEN-FINE-4PK', slug: 'pens-fine-4pk', title: 'Fineliner Pens, 4-pack', price: '$9.00', image: '/static/img/pens-fine.jpg', assetId: ASSET.imgPens },
];

const SANS = 'Söhne, ui-sans-serif, system-ui, sans-serif';

/** Abridged computed styles. A real capture writes only properties that differ from initial. */
const ST = {
  optionStyle: { display: 'block', 'font-size': '14px' },
  html: { display: 'block', 'font-family': SANS, 'font-size': '16px', 'line-height': '24px', color: 'rgb(28, 25, 23)' },
  head: { display: 'none' },
  meta: { display: 'none' },
  body: { display: 'block', 'background-color': 'rgb(250, 250, 249)', 'background-image': 'url("/static/img/paper-texture.png")', 'background-repeat': 'repeat', 'margin-top': '0px', 'margin-right': '0px', 'margin-bottom': '0px', 'margin-left': '0px' },
  app: { display: 'flex', 'flex-direction': 'column', 'min-height': '100vh' },
  header: { display: 'flex', 'align-items': 'center', gap: '24px', 'padding-top': '16px', 'padding-bottom': '16px', 'padding-left': '32px', 'padding-right': '32px', 'background-color': 'rgb(255, 255, 255)', 'border-bottom-width': '1px', 'border-bottom-style': 'solid', 'border-bottom-color': 'rgb(231, 229, 228)', position: 'sticky', top: '0px', 'z-index': '10' },
  headerMobile: { display: 'flex', 'align-items': 'center', gap: '12px', 'padding-top': '12px', 'padding-bottom': '12px', 'padding-left': '16px', 'padding-right': '16px', 'background-color': 'rgb(255, 255, 255)', 'border-bottom-width': '1px', 'border-bottom-style': 'solid', 'border-bottom-color': 'rgb(231, 229, 228)', position: 'sticky', top: '0px', 'z-index': '10' },
  brand: { display: 'inline-flex', 'align-items': 'center', 'text-decoration-line': 'none', color: 'rgb(28, 25, 23)' },
  logo: { display: 'block', width: '132px', height: '28px' },
  searchHost: { display: 'block', 'flex-grow': '1', 'max-width': '420px' },
  searchShell: { display: 'flex', 'align-items': 'center', 'background-color': 'rgb(245, 245, 244)', 'border-top-left-radius': '8px', 'border-top-right-radius': '8px', 'border-bottom-right-radius': '8px', 'border-bottom-left-radius': '8px', 'padding-left': '12px', 'padding-right': '12px' },
  searchInput: { display: 'block', width: '100%', 'background-color': 'rgba(0, 0, 0, 0)', 'border-top-width': '0px', 'border-right-width': '0px', 'border-bottom-width': '0px', 'border-left-width': '0px', 'font-size': '14px', 'line-height': '36px', 'outline-style': 'none', color: 'rgb(28, 25, 23)' },
  nav: { display: 'flex', gap: '20px', 'margin-left': 'auto' },
  navList: { display: 'flex', gap: '20px', 'list-style-type': 'none', 'margin-top': '0px', 'margin-bottom': '0px', 'padding-left': '0px' },
  navItem: { display: 'list-item' },
  navLink: { display: 'inline-block', 'text-decoration-line': 'none', color: 'rgb(68, 64, 60)', 'font-size': '14px' },
  cartBtn: { display: 'inline-flex', 'align-items': 'center', gap: '6px', 'background-color': 'rgb(28, 25, 23)', color: 'rgb(255, 255, 255)', 'border-top-width': '0px', 'border-right-width': '0px', 'border-bottom-width': '0px', 'border-left-width': '0px', 'border-top-left-radius': '6px', 'border-top-right-radius': '6px', 'border-bottom-right-radius': '6px', 'border-bottom-left-radius': '6px', 'padding-top': '8px', 'padding-bottom': '8px', 'padding-left': '14px', 'padding-right': '14px', 'font-size': '14px', cursor: 'pointer' },
  main: { display: 'block', 'flex-grow': '1', 'padding-top': '48px', 'padding-left': '32px', 'padding-right': '32px', 'max-width': '1120px', 'margin-left': 'auto', 'margin-right': 'auto', width: '100%' },
  mainMobile: { display: 'block', 'flex-grow': '1', 'padding-top': '24px', 'padding-left': '16px', 'padding-right': '16px', width: '100%' },
  h1: { display: 'block', 'font-size': '36px', 'line-height': '44px', 'font-weight': '600', 'margin-top': '0px', 'margin-bottom': '32px', 'letter-spacing': '-0.5px' },
  h1Mobile: { display: 'block', 'font-size': '26px', 'line-height': '32px', 'font-weight': '600', 'margin-top': '0px', 'margin-bottom': '20px', 'letter-spacing': '-0.3px' },
  grid: { display: 'grid', 'grid-template-columns': 'repeat(3, minmax(0px, 1fr))', gap: '24px' },
  card: { display: 'flex', 'flex-direction': 'column', 'background-color': 'rgb(255, 255, 255)', 'border-top-width': '1px', 'border-right-width': '1px', 'border-bottom-width': '1px', 'border-left-width': '1px', 'border-top-style': 'solid', 'border-right-style': 'solid', 'border-bottom-style': 'solid', 'border-left-style': 'solid', 'border-top-color': 'rgb(231, 229, 228)', 'border-right-color': 'rgb(231, 229, 228)', 'border-bottom-color': 'rgb(231, 229, 228)', 'border-left-color': 'rgb(231, 229, 228)', 'border-top-left-radius': '12px', 'border-top-right-radius': '12px', 'border-bottom-right-radius': '12px', 'border-bottom-left-radius': '12px', 'padding-top': '16px', 'padding-right': '16px', 'padding-bottom': '16px', 'padding-left': '16px' },
  cardLink: { display: 'block', 'text-decoration-line': 'none' },
  cardImg: { display: 'block', width: '100%', height: 'auto', 'aspect-ratio': '1 / 1', 'object-fit': 'cover', 'border-top-left-radius': '8px', 'border-top-right-radius': '8px', 'border-bottom-right-radius': '8px', 'border-bottom-left-radius': '8px' },
  cardTitle: { display: 'block', 'font-size': '16px', 'line-height': '22px', 'font-weight': '500', 'margin-top': '12px', 'margin-bottom': '4px' },
  cardPrice: { display: 'block', 'font-size': '14px', color: 'rgb(87, 83, 78)', 'margin-top': '0px', 'margin-bottom': '16px' },
  btnPrimary: { display: 'inline-flex', 'align-items': 'center', 'justify-content': 'center', 'background-color': 'rgb(37, 99, 235)', color: 'rgb(255, 255, 255)', 'border-top-width': '0px', 'border-right-width': '0px', 'border-bottom-width': '0px', 'border-left-width': '0px', 'border-top-left-radius': '6px', 'border-top-right-radius': '6px', 'border-bottom-right-radius': '6px', 'border-bottom-left-radius': '6px', 'padding-top': '10px', 'padding-bottom': '10px', 'font-size': '14px', 'font-weight': '500', cursor: 'pointer', 'margin-top': 'auto', transition: 'background-color 120ms ease' },
  footer: { display: 'flex', 'flex-direction': 'column', gap: '16px', 'padding-top': '40px', 'padding-bottom': '40px', 'padding-left': '32px', 'padding-right': '32px', 'border-top-width': '1px', 'border-top-style': 'solid', 'border-top-color': 'rgb(231, 229, 228)', 'margin-top': '64px', color: 'rgb(120, 113, 108)', 'font-size': '13px' },
  reviewsFrame: { display: 'block', width: '100%', height: '180px', 'border-top-width': '0px', 'border-right-width': '0px', 'border-bottom-width': '0px', 'border-left-width': '0px' },
  detailWrap: { display: 'grid', 'grid-template-columns': 'repeat(2, minmax(0px, 1fr))', gap: '48px', 'align-items': 'start' },
  detailWrapMobile: { display: 'flex', 'flex-direction': 'column', gap: '24px' },
  detailImg: { display: 'block', width: '100%', 'aspect-ratio': '1 / 1', 'object-fit': 'cover', 'border-top-left-radius': '12px', 'border-top-right-radius': '12px', 'border-bottom-right-radius': '12px', 'border-bottom-left-radius': '12px' },
  price: { display: 'block', 'font-size': '24px', 'font-weight': '600', 'margin-top': '0px', 'margin-bottom': '24px' },
  qtyRow: { display: 'flex', 'align-items': 'center', gap: '12px', 'margin-bottom': '20px' },
  label: { display: 'inline-block', 'font-size': '14px', color: 'rgb(68, 64, 60)' },
  qtyInput: { display: 'block', width: '72px', 'font-size': '14px', 'line-height': '20px', 'padding-top': '8px', 'padding-bottom': '8px', 'padding-left': '10px', 'padding-right': '10px', 'border-top-width': '1px', 'border-right-width': '1px', 'border-bottom-width': '1px', 'border-left-width': '1px', 'border-top-style': 'solid', 'border-right-style': 'solid', 'border-bottom-style': 'solid', 'border-left-style': 'solid', 'border-top-color': 'rgb(214, 211, 209)', 'border-right-color': 'rgb(214, 211, 209)', 'border-bottom-color': 'rgb(214, 211, 209)', 'border-left-color': 'rgb(214, 211, 209)', 'border-top-left-radius': '6px', 'border-top-right-radius': '6px', 'border-bottom-right-radius': '6px', 'border-bottom-left-radius': '6px' },
  accordion: { display: 'block', 'border-top-width': '1px', 'border-top-style': 'solid', 'border-top-color': 'rgb(231, 229, 228)', 'margin-top': '32px', 'padding-top': '16px' },
  accordionBtn: { display: 'flex', 'align-items': 'center', 'justify-content': 'space-between', width: '100%', 'background-color': 'rgba(0, 0, 0, 0)', 'border-top-width': '0px', 'border-right-width': '0px', 'border-bottom-width': '0px', 'border-left-width': '0px', 'font-size': '15px', 'font-weight': '500', 'padding-top': '8px', 'padding-bottom': '8px', cursor: 'pointer', color: 'rgb(28, 25, 23)' },
  accordionPanel: { display: 'none', 'font-size': '14px', 'line-height': '22px', color: 'rgb(68, 64, 60)' },
  breadcrumb: { display: 'block', 'margin-bottom': '24px' },
  breadcrumbList: { display: 'flex', gap: '8px', 'list-style-type': 'none', 'padding-left': '0px', 'margin-top': '0px', 'margin-bottom': '0px', 'font-size': '13px', color: 'rgb(120, 113, 108)' },
  table: { display: 'table', width: '100%', 'border-collapse': 'collapse', 'font-size': '14px' },
  thead: { display: 'table-header-group' },
  tbody: { display: 'table-row-group' },
  tr: { display: 'table-row' },
  th: { display: 'table-cell', 'text-align': 'left', 'padding-top': '10px', 'padding-bottom': '10px', 'border-bottom-width': '1px', 'border-bottom-style': 'solid', 'border-bottom-color': 'rgb(231, 229, 228)', 'font-weight': '500', color: 'rgb(87, 83, 78)' },
  td: { display: 'table-cell', 'padding-top': '12px', 'padding-bottom': '12px', 'border-bottom-width': '1px', 'border-bottom-style': 'solid', 'border-bottom-color': 'rgb(245, 245, 244)' },
  p: { display: 'block', 'margin-top': '0px', 'margin-bottom': '16px' },
};

const box = (x, y, width, height) => ({ x, y, width, height });

const clickable = (selector, extra = {}) => ({
  discoveredBy: ['a11y-tree', 'event-listeners'],
  selector,
  eventTypes: ['click'],
  stateDeltaObserved: true,
  ...extra,
});

function head(title, mobile) {
  return el('head', { style: ST.head }, [
    el('title', { style: ST.meta }, [txt(title)]),
    el('meta', { attrs: { charset: 'utf-8' }, style: ST.meta }),
    el('meta', {
      attrs: { name: 'viewport', content: mobile ? 'width=device-width, initial-scale=1' : 'width=device-width' },
      style: ST.meta,
    }),
    el('link', { attrs: { rel: 'stylesheet', href: '/static/app.css' }, style: ST.meta }),
    el('link', { attrs: { rel: 'icon', href: '/static/logo.svg' }, style: ST.meta }),
  ]);
}

function siteHeader(mobile) {
  return el('header', { attrs: { class: 'site-header' }, style: mobile ? ST.headerMobile : ST.header, role: 'banner' }, [
    el('a', {
      attrs: { class: 'brand', href: '/' }, style: ST.brand, role: 'link', name: 'Northwind Supply',
      box: box(32, 16, 132, 28), interaction: clickable('header.site-header > a.brand', { stateDeltaObserved: false }),
    }, [
      el('img', { attrs: { src: '/static/logo.svg', alt: 'Northwind Supply', width: '132', height: '28' }, style: ST.logo }),
    ]),
    // §11: shadow DOM is pierced and flattened with a marker attribute.
    el('nw-search', { attrs: { class: 'search' }, style: ST.searchHost, shadowHost: { mode: 'open' } }, [
      el('div', { attrs: { class: 'shell' }, style: ST.searchShell, shadowPart: 'nw-search' }, [
        el('input', {
          attrs: { type: 'search', placeholder: 'Search supplies', 'aria-label': 'Search supplies' },
          style: ST.searchInput, role: 'searchbox', name: 'Search supplies', shadowPart: 'nw-search',
          box: box(196, 22, 396, 36),
          interaction: {
            discoveredBy: ['a11y-tree', 'pseudo-class-rule'], selector: 'nw-search >>> input[type=search]',
            eventTypes: ['input', 'focus', 'keydown'], stateDeltaObserved: true,
          },
        }),
      ]),
    ]),
    el('nav', { attrs: { 'aria-label': 'Primary' }, style: ST.nav, role: 'navigation', name: 'Primary' }, [
      el('ul', { style: ST.navList, role: 'list' }, [
        el('li', { style: ST.navItem, role: 'listitem' }, [
          el('a', { attrs: { href: '/shop' }, style: ST.navLink, role: 'link', name: 'Shop', box: box(700, 24, 38, 20), interaction: clickable('nav[aria-label=Primary] a[href="/shop"]', { stateDeltaObserved: false }) }, [txt('Shop')]),
        ]),
        el('li', { style: ST.navItem, role: 'listitem' }, [
          el('a', { attrs: { href: '/about' }, style: ST.navLink, role: 'link', name: 'About', box: box(758, 24, 42, 20), interaction: clickable('nav[aria-label=Primary] a[href="/about"]', { stateDeltaObserved: false }) }, [txt('About')]),
        ]),
      ]),
    ]),
    el('button', {
      attrs: { class: 'cart-button', type: 'button', 'aria-label': 'Cart, 0 items' },
      style: ST.cartBtn, role: 'button', name: 'Cart, 0 items', box: box(1140, 16, 108, 36),
      interaction: clickable('button.cart-button'),
    }, [txt('Cart (0)')]),
  ]);
}

function siteFooter() {
  return el('footer', { style: ST.footer, role: 'contentinfo' }, [
    el('p', { style: ST.p }, [txt('Northwind Supply — a fictional storefront used as a siteforge fixture.')]),
    el('iframe', {
      attrs: { src: 'https://widgets.example.net/reviews?site=northwind', title: 'Customer reviews', loading: 'lazy' },
      style: ST.reviewsFrame,
      iframe: {
        sameOrigin: false,
        src: 'https://widgets.example.net/reviews?site=northwind',
        placeholderAssetId: ASSET.reviewsPlaceholder,
        gapId: GAP.thirdPartyIframe,
      },
    }),
  ]);
}

function productCard(p, i) {
  return el('article', { attrs: { class: 'product-card', 'data-sku': p.sku }, style: ST.card }, [
    el('a', {
      attrs: { class: 'card-link', href: `/product/${p.slug}` }, style: ST.cardLink,
      role: 'link', name: p.title, box: box(32 + i * 368, 220, 320, 320),
      interaction: clickable(`article[data-sku="${p.sku}"] a.card-link`, { discoveredBy: ['a11y-tree', 'pseudo-class-rule'], stateDeltaObserved: true }),
    }, [
      el('img', { attrs: { src: p.image, alt: p.title, width: '320', height: '320', loading: 'lazy' }, style: ST.cardImg }),
    ]),
    el('h3', { attrs: { class: 'card-title' }, style: ST.cardTitle, role: 'heading', name: p.title, level: 3 }, [txt(p.title)]),
    el('p', { attrs: { class: 'card-price' }, style: ST.cardPrice }, [txt(p.price)]),
    el('button', {
      attrs: { class: 'btn btn-primary', type: 'button', 'data-sku': p.sku }, style: ST.btnPrimary,
      role: 'button', name: `Add ${p.title} to cart`, box: box(48 + i * 368, 604, 288, 40),
      interaction: clickable(`article[data-sku="${p.sku}"] button.btn-primary`),
    }, [txt('Add to cart')]),
  ]);
}

export function homePage() {
  const title = 'Northwind Supply — everyday supplies, honestly priced';
  return {
    title,
    tree: el('html', { attrs: { lang: 'en' }, style: ST.html }, [
      head(title, false),
      el('body', { style: ST.body }, [
        el('div', { attrs: { id: 'app' }, style: ST.app }, [
          siteHeader(false),
          el('main', { style: ST.main, role: 'main' }, [
            el('h1', { style: ST.h1, role: 'heading', name: 'Everyday supplies, honestly priced', level: 1 }, [
              txt('Everyday supplies, honestly priced'),
            ]),
            el('section', { attrs: { class: 'product-grid', 'aria-label': 'Products' }, style: ST.grid, role: 'region', name: 'Products' },
              PRODUCTS.map((p, i) => productCard(p, i))),
          ]),
          siteFooter(),
        ]),
      ]),
    ]),
  };
}

export function productPage(product, { mobile }) {
  const title = `${product.title} — Northwind Supply`;
  return {
    title,
    tree: el('html', { attrs: { lang: 'en' }, style: ST.html }, [
      head(title, mobile),
      el('body', { style: ST.body }, [
        el('div', { attrs: { id: 'app' }, style: ST.app }, [
          siteHeader(mobile),
          el('main', { style: mobile ? ST.mainMobile : ST.main, role: 'main' }, [
            el('nav', { attrs: { 'aria-label': 'Breadcrumb' }, style: ST.breadcrumb, role: 'navigation', name: 'Breadcrumb' }, [
              el('ol', { style: ST.breadcrumbList, role: 'list' }, [
                el('li', { style: ST.navItem, role: 'listitem' }, [
                  el('a', { attrs: { href: '/' }, style: ST.navLink, role: 'link', name: 'Home', box: box(32, 96, 36, 18), interaction: clickable('nav[aria-label=Breadcrumb] a[href="/"]', { stateDeltaObserved: false }) }, [txt('Home')]),
                ]),
                el('li', { style: ST.navItem, role: 'listitem' }, [txt(product.title)]),
              ]),
            ]),
            el('div', { attrs: { class: 'product-detail' }, style: mobile ? ST.detailWrapMobile : ST.detailWrap }, [
              el('img', { attrs: { src: product.image, alt: product.title, width: '640', height: '640' }, style: ST.detailImg }),
              el('div', { attrs: { class: 'buy-panel' }, style: { display: 'block' } }, [
                el('h1', { style: mobile ? ST.h1Mobile : ST.h1, role: 'heading', name: product.title, level: 1 }, [txt(product.title)]),
                el('p', { attrs: { class: 'price' }, style: ST.price }, [txt(product.price)]),
                // A closed shadow root: element.shadowRoot is null from page
                // context by design, so its content is permanently unreachable.
                el('nw-rating', {
                  attrs: { class: 'rating', 'data-value': '4.5' },
                  style: { display: 'block', height: '20px', 'margin-bottom': '16px' },
                  shadowHost: { mode: 'closed', gapId: GAP.closedShadowRoot },
                }),
                el('div', { attrs: { class: 'qty-row' }, style: ST.qtyRow }, [
                  el('label', { attrs: { for: 'qty' }, style: ST.label }, [txt('Quantity')]),
                  el('input', {
                    attrs: { id: 'qty', name: 'qty', type: 'number', value: '1', min: '1', max: '10' },
                    style: ST.qtyInput, role: 'spinbutton', name: 'Quantity', a11yValue: '1',
                    box: box(mobile ? 108 : 700, 300, 72, 38),
                    interaction: { discoveredBy: ['a11y-tree', 'pseudo-class-rule'], selector: '#qty', eventTypes: ['input', 'change', 'focus'], stateDeltaObserved: true },
                  }),
                ]),
                el('button', {
                  attrs: { class: 'btn btn-primary', type: 'button', 'data-sku': product.sku },
                  style: ST.btnPrimary, role: 'button', name: `Add ${product.title} to cart`,
                  box: box(mobile ? 16 : 700, 356, mobile ? 358 : 320, 40),
                  interaction: clickable('.buy-panel button.btn-primary'),
                }, [txt('Add to cart')]),
                el('div', { attrs: { class: 'accordion', 'data-state': 'closed' }, style: ST.accordion }, [
                  el('button', {
                    attrs: { class: 'accordion-trigger', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'details-panel' },
                    style: ST.accordionBtn, role: 'button', name: 'Product details', expanded: false,
                    box: box(mobile ? 16 : 700, 428, mobile ? 358 : 320, 36),
                    interaction: clickable('button.accordion-trigger', { discoveredBy: ['a11y-tree', 'event-listeners', 'pseudo-class-rule'] }),
                  }, [txt('Product details')]),
                  el('div', { attrs: { id: 'details-panel', hidden: '' }, style: ST.accordionPanel, role: 'region', name: 'Product details' }, [
                    txt('Vitreous enamel over steel. Dishwasher safe. Not for microwave use.'),
                  ]),
                ]),
              ]),
            ]),
            // §11: a same-origin iframe is recursed into and captured as a nested
            // route. Desktop only — the mobile layout links out instead, which is
            // both realistic and keeps the nested capture to one content box.
            ...(mobile ? [] : [
              el('section', { attrs: { class: 'size-guide' }, style: { display: 'block', 'margin-top': '48px' } }, [
                el('h2', { style: { display: 'block', 'font-size': '18px', 'font-weight': '600', 'margin-bottom': '12px' }, role: 'heading', name: 'Size guide', level: 2 }, [txt('Size guide')]),
                el('iframe', {
                  attrs: { src: '/embeds/size-guide', title: 'Size guide', width: '640', height: '420' },
                  style: { display: 'block', width: '640px', height: '420px', 'border-top-width': '0px', 'border-right-width': '0px', 'border-bottom-width': '0px', 'border-left-width': '0px' },
                  iframe: { sameOrigin: true, src: `${ORIGIN}/embeds/size-guide`, routeId: SIZE_GUIDE_ROUTE_ID },
                }),
              ]),
            ]),
          ]),
          siteFooter(),
        ]),
      ]),
    ]),
  };
}

/** The nested route the product page's same-origin iframe is captured as. */
export const SIZE_GUIDE_ROUTE_ID = 'embeds-size-guide--anon-desktop--i0';
export const SIZE_GUIDE_BOX = { x: 32, y: 620, width: 640, height: 420 };

export function sizeGuidePage() {
  const title = 'Size guide';
  const rows = [['12oz mug', '95 mm', '82 mm', '340 ml'], ['A5 notebook', '210 mm', '148 mm', '—']];
  return {
    title,
    tree: el('html', { attrs: { lang: 'en' }, style: ST.html }, [
      head(title, false),
      el('body', { style: { display: 'block', 'background-color': 'rgb(255, 255, 255)', 'margin-top': '0px', 'margin-right': '0px', 'margin-bottom': '0px', 'margin-left': '0px', 'padding-top': '16px', 'padding-left': '16px', 'padding-right': '16px', 'font-size': '13px' } }, [
        el('table', { style: ST.table, role: 'table', name: 'Dimensions' }, [
          el('thead', { style: ST.thead, role: 'rowgroup' }, [
            el('tr', { style: ST.tr, role: 'row' }, ['Item', 'Height', 'Diameter', 'Capacity'].map((h) =>
              el('th', { attrs: { scope: 'col' }, style: ST.th, role: 'columnheader', name: h }, [txt(h)]))),
          ]),
          el('tbody', { style: ST.tbody, role: 'rowgroup' }, rows.map((r) =>
            el('tr', { style: ST.tr, role: 'row' }, r.map((c) =>
              el('td', { style: ST.td, role: 'cell', name: c }, [txt(c)]))))),
        ]),
      ]),
    ]),
  };
}

/**
 * A static marketing page. Rendered identically whether or not a session exists,
 * which is what makes it the natural fixture for the shared-content pointer.
 */
export function aboutPage() {
  const title = 'About — Northwind Supply';
  return {
    title,
    tree: el('html', { attrs: { lang: 'en' }, style: ST.html }, [
      head(title, false),
      el('body', { style: ST.body }, [
        el('div', { attrs: { id: 'app' }, style: ST.app }, [
          siteHeader(false),
          el('main', { style: ST.main, role: 'main' }, [
            el('h1', { style: ST.h1, role: 'heading', name: 'About Northwind Supply', level: 1 }, [
              txt('About Northwind Supply'),
            ]),
            el('p', { style: ST.p }, [txt('We sell a small number of well-made things and try not to sell anything else.')]),
            el('p', { style: ST.p }, [txt('Everything ships from one warehouse. Returns are accepted for sixty days.')]),
          ]),
          siteFooter(),
        ]),
      ]),
    ]),
  };
}

export function accountOrdersPage() {
  const title = 'Your orders — Northwind Supply';
  const rows = [
    ['NW-10428', '2026-08-14', 'Delivered', '$30.50'],
    ['NW-10391', '2026-07-02', 'Delivered', '$18.00'],
  ];
  return {
    title,
    tree: el('html', { attrs: { lang: 'en' }, style: ST.html }, [
      head(title, false),
      el('body', { style: ST.body }, [
        el('div', { attrs: { id: 'app' }, style: ST.app }, [
          siteHeader(false),
          el('main', { style: ST.main, role: 'main' }, [
            el('h1', { style: ST.h1, role: 'heading', name: 'Your orders', level: 1 }, [txt('Your orders')]),
            // The order-status filter. It is here so the fixture can demonstrate the
            // one kind of evidence that actually settles a closed domain: the API's
            // `status` field is an enum because this control constrains it, not
            // because a thin sample happened to show three values (decision 0010).
            el('select', {
              attrs: { name: 'status', id: 'order-status-filter' },
              style: { display: 'inline-block', 'font-size': '14px', 'padding-top': '6px', 'padding-bottom': '6px', 'padding-left': '8px', 'padding-right': '8px', 'border-top-left-radius': '6px', 'border-top-right-radius': '6px', 'border-bottom-right-radius': '6px', 'border-bottom-left-radius': '6px' },
              role: 'combobox', name: 'Filter by status', box: box(32, 150, 180, 34),
              interaction: {
                discoveredBy: ['a11y-tree'], selector: 'select#order-status-filter',
                eventTypes: ['change'], stateDeltaObserved: false,
              },
            }, [
              el('option', { attrs: { value: 'placed' }, style: ST.optionStyle, role: 'option', name: 'Placed' }, [txt('Placed')]),
              el('option', { attrs: { value: 'shipped' }, style: ST.optionStyle, role: 'option', name: 'Shipped' }, [txt('Shipped')]),
              el('option', { attrs: { value: 'delivered' }, style: ST.optionStyle, role: 'option', name: 'Delivered' }, [txt('Delivered')]),
            ]),
            el('table', { style: ST.table, role: 'table', name: 'Your orders' }, [
              el('thead', { style: ST.thead, role: 'rowgroup' }, [
                el('tr', { style: ST.tr, role: 'row' }, ['Order', 'Placed', 'Status', 'Total'].map((h) =>
                  el('th', { attrs: { scope: 'col' }, style: ST.th, role: 'columnheader', name: h }, [txt(h)]))),
              ]),
              el('tbody', { style: ST.tbody, role: 'rowgroup' }, rows.map((r) =>
                el('tr', { style: ST.tr, role: 'row' }, r.map((c) =>
                  el('td', { style: ST.td, role: 'cell', name: c }, [txt(c)]))))),
            ]),
            // §6's destructive heuristic has something to actually skip.
            el('section', { attrs: { class: 'danger-zone' }, style: { display: 'block', 'margin-top': '48px' } }, [
              el('h2', { style: { display: 'block', 'font-size': '18px', 'font-weight': '600', 'margin-bottom': '12px' }, role: 'heading', name: 'Danger zone', level: 2 }, [txt('Danger zone')]),
              el('button', {
                attrs: { class: 'btn btn-danger', type: 'button' },
                style: { display: 'inline-flex', 'background-color': 'rgb(220, 38, 38)', color: 'rgb(255, 255, 255)', 'border-top-width': '0px', 'border-right-width': '0px', 'border-bottom-width': '0px', 'border-left-width': '0px', 'border-top-left-radius': '6px', 'border-top-right-radius': '6px', 'border-bottom-right-radius': '6px', 'border-bottom-left-radius': '6px', 'padding-top': '10px', 'padding-bottom': '10px', 'padding-left': '16px', 'padding-right': '16px', 'font-size': '14px', cursor: 'pointer' },
                role: 'button', name: 'Delete account', box: box(32, 700, 160, 40),
                interaction: {
                  discoveredBy: ['a11y-tree', 'event-listeners'], selector: 'button.btn-danger',
                  eventTypes: ['click'], stateDeltaObserved: false,
                  destructive: { matchedTerm: 'delete', skipped: true },
                },
              }, [txt('Delete account')]),
            ]),
          ]),
          siteFooter(),
        ]),
      ]),
    ]),
  };
}
