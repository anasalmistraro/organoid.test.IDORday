/* ============================================================================
 * viewer.js — Camada de visualização (OpenSeadragon)
 *
 * Encapsula EXATAMENTE a lógica do visualizador original (index.html):
 *   - OpenSeadragon 2.4.2 + plugin openseadragon-filtering
 *   - tileSources: images/<ID>/focus_<n>.xml   (caminhos RELATIVOS)
 *   - Foco 1..5 trocando o tiled image e preservando zoom/centro
 *   - Gamma Tuning: ON = GAMMA(0.5) + BRIGHTNESS(-15) ; OFF = GAMMA(1)
 *   - Zoom, navegação e navigator do OpenSeadragon
 *
 * Diferença em relação ao original: aqui o alvo é um ID completo do CSV
 * (ex.: "Organoid_1", "Organoid_Acq3") em vez de apenas um número, o que
 * torna o carregamento robusto para todos os nomes de pasta existentes.
 * ==========================================================================*/

const OrganoidViewer = (function () {
  let viewer = null;      // instância atual do OpenSeadragon
  let currentId = null;   // ID do organoide carregado
  let currentFocus = 1;   // nível de foco atual (1..5)
  let gammaOn = false;    // estado do Gamma Tuning

  const OSD_PREFIX =
    "https://cdnjs.cloudflare.com/ajax/libs/openseadragon/2.4.2/images/";

  function tileSource(id, focus) {
    return `images/${id}/focus_${focus}.xml`;
  }

  // Aplica os filtros conforme o estado do Gamma (idêntico ao original).
  function applyFilters() {
    if (!viewer) return;
    if (gammaOn) {
      viewer.setFilterOptions({
        filters: {
          processors: [
            OpenSeadragon.Filters.GAMMA(0.5),
            OpenSeadragon.Filters.BRIGHTNESS(-15),
          ],
        },
      });
    } else {
      viewer.setFilterOptions({
        filters: { processors: OpenSeadragon.Filters.GAMMA(1) },
      });
    }
  }

  /**
   * Carrega um organoide pelo ID (nome da pasta em images/).
   * Destrói a instância anterior, começa no foco 1 e reaplica os filtros.
   * @param {string} id       ex.: "Organoid_37"
   * @param {object} [opts]   { onOpen, onFail }
   */
  function load(id, opts = {}) {
    currentId = id;
    currentFocus = 1;

    if (viewer) {
      viewer.destroy();
      viewer = null;
    }

    viewer = OpenSeadragon({
      id: "osd-viewport",
      prefixUrl: OSD_PREFIX,
      showFullPageControl: false,
      showNavigator: true,
      navigatorPosition: "TOP_RIGHT",
      maxZoomPixelRatio: 4,
      tileSources: tileSource(id, 1),
      blendTime: 0.2,
      immediateRender: true,
      gestureSettingsMouse: { clickToZoom: false },
    });

    viewer.addHandler("open", function () {
      applyFilters();
      if (typeof opts.onOpen === "function") opts.onOpen();
    });

    viewer.addHandler("open-failed", function () {
      if (typeof opts.onFail === "function") opts.onFail();
    });
  }

  /**
   * Troca o nível de foco preservando zoom e centro (idêntico ao original:
   * addTiledImage + remoção do item anterior + reaplicação de filtros).
   * @param {number} level 1..5
   */
  function setFocus(level) {
    if (!viewer) return;
    level = parseInt(level, 10);
    if (isNaN(level) || level < 1 || level > 5) return;
    currentFocus = level;

    const zoom = viewer.viewport.getZoom();
    const center = viewer.viewport.getCenter();

    viewer.addTiledImage({
      tileSource: tileSource(currentId, level),
      success: function () {
        viewer.viewport.zoomTo(zoom, center);
        if (viewer.world.getItemCount() > 1) {
          viewer.world.removeItem(viewer.world.getItemAt(0));
        }
        applyFilters();
      },
    });
  }

  /** Liga/desliga o Gamma Tuning. */
  function setGamma(on) {
    gammaOn = !!on;
    applyFilters();
  }

  function getFocus() { return currentFocus; }
  function getGamma() { return gammaOn; }

  function destroy() {
    if (viewer) {
      viewer.destroy();
      viewer = null;
    }
    currentId = null;
  }

  /**
   * Calcula a URL de um thumbnail leve a partir do próprio Deep Zoom,
   * sem instanciar um visualizador. Lê focus_1.xml, descobre o maior nível
   * que cabe em um único tile e devolve .../focus_1_files/<nivel>/0_0.png.
   * @param {string} id
   * @returns {Promise<string|null>}
   */
  async function getThumbUrl(id) {
    try {
      const res = await fetch(`images/${id}/focus_1.xml`);
      if (!res.ok) return null;
      const xml = new DOMParser().parseFromString(
        await res.text(),
        "application/xml"
      );
      const image = xml.querySelector("Image");
      const size = xml.querySelector("Size");
      if (!image || !size) return null;

      const tile = parseInt(image.getAttribute("TileSize"), 10) || 256;
      const W = parseInt(size.getAttribute("Width"), 10);
      const H = parseInt(size.getAttribute("Height"), 10);
      if (!W || !H) return null;

      const maxLevel = Math.ceil(Math.log2(Math.max(W, H)));
      // maior nível cujo lado maior cabe num único tile
      let level = maxLevel;
      for (let L = maxLevel; L >= 0; L--) {
        const f = Math.pow(2, maxLevel - L);
        if (Math.ceil(W / f) <= tile && Math.ceil(H / f) <= tile) {
          level = L;
          break;
        }
      }
      if (level < 2) level = 2; // níveis muito baixos costumam ser omitidos
      return `images/${id}/focus_1_files/${level}/0_0.png`;
    } catch (e) {
      return null;
    }
  }

  return { load, setFocus, setGamma, getFocus, getGamma, destroy, getThumbUrl };
})();
