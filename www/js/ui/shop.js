/* ==========================================================================
 * shop.js - Skins Shop: renders the catalogue, handles buying & equipping.
 *
 * All economy decisions (do I have enough coins? is it already unlocked?)
 * are delegated to SR.Storage so the shop UI never owns game state.
 * ========================================================================== */
(function (global) {
  'use strict';

  var SR = (global.SR = global.SR || {});

  var Shop = {
    els: null,
    _built: false,

    init: function () {
      this.els = {
        grid: document.getElementById('shop-grid'),
        coins: document.getElementById('shop-coins')
      };

      // React to purchases made anywhere else in the app
      SR.Events.on('coins:changed', function () { Shop.refreshWallet(); if (Shop._built) Shop.refreshCards(); });
      SR.Events.on('skin:selected', function () { if (Shop._built) Shop.refreshCards(); });
      return this;
    },

    open: function () {
      SR.Screens.show('shop', true);
      this.build();
      this.refreshWallet();
      this.refreshCards();
    },

    refreshWallet: function () {
      if (this.els.coins) this.els.coins.textContent = SR.Storage.getCoins();
    },

    /* ------------------------------------------------------------- build */
    build: function () {
      if (!this.els.grid) return;
      this.els.grid.innerHTML = '';
      var self = this;

      SR.SKINS.forEach(function (skin) {
        var card = document.createElement('div');
        card.className = 'skin-card';
        card.dataset.skin = skin.id;

        var preview = document.createElement('div');
        preview.className = 'skin-card__preview';
        var canvas = document.createElement('canvas');
        canvas.width = 192;                       // 2x for crisp rendering
        canvas.height = 144;
        preview.appendChild(canvas);

        var body = document.createElement('div');
        body.className = 'skin-card__body';
        body.innerHTML =
          '<h3 class="skin-card__name">' + skin.name + '</h3>' +
          '<p class="skin-card__desc">' + skin.desc + '</p>';

        var action = document.createElement('div');
        action.className = 'skin-card__action';
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn';
        button.addEventListener('click', function (e) {
          e.stopPropagation();
          self.onAction(skin);
        });
        action.appendChild(button);

        card.appendChild(preview);
        card.appendChild(body);
        card.appendChild(action);
        card.addEventListener('click', function () { self.onAction(skin); });

        self.els.grid.appendChild(card);

        // draw the live preview once (canvas is static)
        SR.drawSkinPreview(canvas, skin);
      });

      this._built = true;
    },

    /* ------------------------------------------------------------ render */
    refreshCards: function () {
      if (!this.els.grid) return;
      var coins = SR.Storage.getCoins();
      var selected = SR.Storage.getSelectedSkin();
      var cards = this.els.grid.querySelectorAll('.skin-card');

      for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        var id = card.dataset.skin;
        var skin = SR.getSkin(id);
        var unlocked = SR.Storage.isSkinUnlocked(id);
        var isSel = (id === selected);

        card.classList.toggle('is-locked', !unlocked);
        card.classList.toggle('is-selected', isSel);

        var btn = card.querySelector('.skin-card__action button');
        if (!btn) continue;

        btn.className = 'btn ' + (isSel ? 'btn--equipped' : (unlocked ? 'btn--equip' : 'btn--buy'));
        if (isSel) {
          btn.textContent = 'EQUIPPED';
        } else if (unlocked) {
          btn.textContent = 'EQUIP';
        } else {
          var poor = coins < skin.price;
          btn.classList.toggle('is-poor', poor);
          btn.innerHTML = '<span class="price">' + skin.price + '</span>';
        }

        // locked previews get a padlock overlay
        var preview = card.querySelector('.skin-card__preview');
        if (preview) {
          var lock = preview.querySelector('.skin-card__lock');
          if (!unlocked && !lock) {
            lock = document.createElement('div');
            lock.className = 'skin-card__lock';
            lock.textContent = '🔒';
            preview.appendChild(lock);
          } else if (unlocked && lock) {
            preview.removeChild(lock);
          }
        }
      }
    },

    /* ------------------------------------------------------------ action */
    onAction: function (skin) {
      var id = skin.id;
      SR.Sfx.play('click');

      if (SR.Storage.isSkinUnlocked(id)) {
        SR.Storage.selectSkin(id);
        this.refreshCards();
        SR.Screens.toast(skin.name + ' equipped');
        return;
      }

      var coins = SR.Storage.getCoins();
      if (coins < skin.price) {
        SR.Screens.toast('Need ' + (skin.price - coins) + ' more coins');
        return;
      }

      if (SR.Storage.spendCoins(skin.price)) {
        SR.Storage.unlockSkin(id);
        SR.Storage.selectSkin(id);
        SR.Sfx.play('unlock');
        this.refreshWallet();
        this.refreshCards();
        SR.Screens.toast(skin.name + ' unlocked!');
        SR.Events.emit('skin:bought', id);
      }
    },

    /** Called when the shop screen is closed. */
    close: function () { /* nothing to clean up - cards stay cached */ }
  };

  SR.Shop = Shop;

})(typeof window !== 'undefined' ? window : globalThis);
