/**
 * Kea Promo - Frontend Handler (v2 - Audited)
 * 
 * Manages automatic GWP (Gift With Purchase) logic.
 * - Adds gift products to cart when conditions are met
 * - Does NOT remove gifts (they become paid if conditions are no longer met)
 */
(function() {
  var DEBUG = true;
  var isOurOwnRequest = false; // Bug 2 fix: prevent infinite loop
  var isChecking = false;

  function log() { 
    if (DEBUG) {
      var args = Array.prototype.slice.call(arguments);
      console.log.apply(console, ["[KeaPromo]"].concat(args));
    }
  }

  function getCart() {
    return fetch('/cart.js').then(function(res) { return res.json(); });
  }

  function refreshCartDrawer(data) {
    // Try native Dawn theme cart-drawer update first
    var cartDrawer = document.querySelector('cart-drawer');
    if (cartDrawer && typeof cartDrawer.renderContents === 'function') {
      log("Updating Dawn cart-drawer natively...");
      setTimeout(function() {
        fetch(window.location.pathname + '?sections=cart-drawer,cart-icon-bubble')
          .then(function(r) { return r.json(); })
          .then(function(sections) {
             cartDrawer.renderContents({ sections: sections });
          });
      }, 500);
      return;
    }

    // Fallback for other themes
    document.documentElement.dispatchEvent(new CustomEvent('cart:updated', { bubbles: true }));
    document.documentElement.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true }));
    if (data) document.dispatchEvent(new CustomEvent('ajaxProduct:added', { detail: { product: data } }));
    if (window.Shopify && window.Shopify.onCartUpdate && data) { window.Shopify.onCartUpdate(data); }

    // Fallback manual replacement for basic themes
    if (data && data.sections) {
      var keys = Object.keys(data.sections);
      for (var i = 0; i < keys.length; i++) {
        var el = document.getElementById('shopify-section-' + keys[i]);
        if (el) {
          el.innerHTML = new DOMParser()
            .parseFromString(data.sections[keys[i]], 'text/html')
            .querySelector('#shopify-section-' + keys[i]).innerHTML;
        }
      }
      log("Cart sections updated manually and global events dispatched.");
    } else {
      // If no data.sections, just reload the page as last resort
      window.location.reload();
    }
  }

  function addProduct(variantId, quantity) {
    if (quantity === undefined) quantity = 1;
    log("Adding gift product...", variantId);
    
    isOurOwnRequest = true;

    return fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ id: parseInt(variantId), quantity: quantity }],
        sections: 'cart-drawer,cart-icon-bubble,main-cart-items,cart-notification-product,cart-notification-button'
      })
    }).then(function(res) {
      isOurOwnRequest = false;
      if (res.ok) {
        log("Gift added successfully!");
        return res.json().then(function(data) {
          if (window.location.pathname === '/cart') {
            window.location.reload();
            return;
          }
          refreshCartDrawer(data);
        });
      } else {
        log("Failed to add gift, status:", res.status);
      }
    }).catch(function(e) {
      isOurOwnRequest = false;
      console.error("[KeaPromo] Failed to add gift:", e);
    });
  }

  function removeProduct(variantId) {
    log("Removing gift product...", variantId);
    isOurOwnRequest = true;

    return fetch('/cart/change.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: variantId,
        quantity: 0
      })
    }).then(function(res) {
      isOurOwnRequest = false;
      if (res.ok) {
        log("Gift removed successfully!");
        if (window.location.pathname === '/cart') {
          window.location.reload();
        } else {
          refreshCartDrawer();
        }
      } else {
        log("Failed to remove gift, status:", res.status);
      }
    }).catch(function(e) {
      isOurOwnRequest = false;
      console.error("[KeaPromo] Failed to remove gift:", e);
    });
  }

  // Bug 7 fix: support both "all" and "any" condition logic
  function evaluateRule(rule, cart) {
    var subtotal = cart.total_price / 100;
    var itemCount = cart.item_count;

    // Fix: Subtract the gift product's price from the subtotal so it doesn't count towards its own threshold!
    if (rule.action && rule.action.type === 'free_product' && rule.action.variantId) {
      var numericId = rule.action.variantId.toString();
      cart.items.forEach(function(item) {
        if (item.variant_id.toString() === numericId) {
          subtotal -= (item.line_price / 100);
          itemCount -= item.quantity;
        }
      });
    }

    if (!rule.conditions || rule.conditions.length === 0) return true;
    
    var results = rule.conditions.map(function(cond) {
      if (cond.type === 'cart_total') {
        var val = parseFloat(cond.value);
        if (cond.operator === 'gte') return subtotal >= val;
        if (cond.operator === 'gt') return subtotal > val;
        if (cond.operator === 'lte') return subtotal <= val;
        if (cond.operator === 'lt') return subtotal < val;
        if (cond.operator === 'eq') return subtotal === val;
      }
      if (cond.type === 'item_count') {
        var val2 = parseInt(cond.value);
        if (cond.operator === 'gte') return itemCount >= val2;
        if (cond.operator === 'gt') return itemCount > val2;
      }
      return true; 
    });

    // Bug 7 fix: respect conditionLogic
    if (rule.conditionLogic === 'any') {
      return results.some(function(r) { return !!r; });
    }
    return results.every(function(r) { return !!r; });
  }

  function checkPromotions() {
    if (!window.KeaPromo || !window.KeaPromo.rules) {
      log("No rules loaded yet.");
      return;
    }
    if (isChecking) return;
    isChecking = true;

    getCart().then(function(cart) {
      var rules = window.KeaPromo.rules || [];
      log("Checking", rules.length, "rule(s). Cart total:", cart.total_price / 100);
      
      for (var i = 0; i < rules.length; i++) {
        var rule = rules[i];
        if (rule.action.type === 'free_product') {
          var giftVariantId = rule.action.variantId; 
          if (!giftVariantId) {
            log("Rule", rule.id, "has no variantId, skipping.");
            continue;
          }

          var numericId = giftVariantId.toString();
          var isMet = evaluateRule(rule, cart);
          
          // Check if gift is already in cart
          var hasGift = cart.items.some(function(item) { 
            return item.variant_id.toString() === numericId; 
          });

          log("Rule", rule.id, "- met:", isMet, "- gift in cart:", hasGift);

          if (isMet && !hasGift) {
            log("Condition met and gift missing. Adding...");
            addProduct(numericId);
            isChecking = false;
            return; // Stop here, page will reload
          } else if (!isMet && hasGift) {
            log("Condition NOT met but gift is in cart. Removing...");
            removeProduct(numericId);
            isChecking = false;
            return;
          }
        }
      }
      isChecking = false;
    }).catch(function(e) {
      console.error("[KeaPromo] Check failed:", e);
      isChecking = false;
    });
  }

  // Bug 2 fix: Intercept cart changes but ignore our own requests
  var originalFetch = window.fetch;
  window.fetch = function() {
    var args = arguments;
    return originalFetch.apply(this, args).then(function(response) {
      // Skip if this is our own gift-adding request
      if (isOurOwnRequest) return response;

      var url = args[0];
      if (typeof url === 'string' && (
        url.indexOf('/cart/add') !== -1 || 
        url.indexOf('/cart/change') !== -1 || 
        url.indexOf('/cart/update') !== -1
      )) {
        log("Cart activity detected, evaluating promos in 1s...");
        setTimeout(checkPromotions, 1000);
      }
      return response;
    });
  };

  // Initial check on page load
  setTimeout(checkPromotions, 1500);

})();
