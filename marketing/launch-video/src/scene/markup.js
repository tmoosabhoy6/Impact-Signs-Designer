// Static stage markup. Image paths are relative to public/ and are resolved with staticFile() at mount.
export const MARKUP = `
<div id="stage">

  <!-- Backgrounds -->
  <div id="bg-dark" class="layer"></div>
  <svg id="grid" class="layer" width="1920" height="1080"></svg>
  <div id="bg-paper" class="layer"></div>

  <!-- 1 · Hook -->
  <section id="s-hook" class="scene">
    <div class="kt center" id="hook-a">
      <div class="ln">Every bronze plaque</div>
      <div class="ln">starts as an <em class="bz">order.</em></div>
    </div>
    <div class="kt center" id="hook-b">
      <div class="ln small" id="hook-b1">A spec sheet.</div>
      <div class="ln small" id="hook-b2">A Word file.</div>
      <div class="ln small" id="hook-b3">A photo.</div>
    </div>
  </section>

  <!-- 2 · Chaos -->
  <section id="s-chaos" class="scene">
    <div id="chaos-cards"></div>
    <div class="kt center" id="chaos-t">
      <div class="ln">Then hours of drafting,</div>
      <div class="ln">proofing and redrawing.</div>
    </div>
    <div class="kt center" id="chaos-n">
      <div class="ln big">Not anymore.</div>
    </div>
  </section>

  <!-- 3 · Reveal -->
  <section id="s-reveal" class="scene">
    <div id="reveal-disc"></div>
    <div id="reveal-box">
      <img id="reveal-logo" src="media/logo.png" alt="">
      <div id="reveal-name"><span>Plaque</span> <span>Proof</span> <span>Studio</span></div>
      <div id="reveal-rule"></div>
      <div id="reveal-tag">Order in. Concepts, proof and production file out.</div>
    </div>
  </section>

  <!-- 4 · The app -->
  <section id="s-app" class="scene">
    <div id="winWrap">
      <div id="win">
        <div id="winTilt">
          <div id="topbar">
            <img src="media/logo.png" class="tb-logo" alt="">
            <div class="tb-tabs"><span class="on">Plaque Proof Studio</span><span>AI Upscaler</span><span>Vectorizer</span><span>Proof Merger</span></div>
            <div class="tb-job"><span class="mono">32885</span> Raccoon River Pet Rescue</div>
            <div class="tb-steps">
              <div class="st" data-k="order"><span class="v todo">01 Order</span><span class="v act">01 Order</span><span class="v done"><i class="ic" data-i="check"></i>Order</span></div>
              <b class="dash"></b>
              <div class="st" data-k="concepts"><span class="v todo">02 Concepts</span><span class="v act">02 Concepts</span><span class="v done"><i class="ic" data-i="check"></i>Concepts</span></div>
              <b class="dash"></b>
              <div class="st" data-k="proof"><span class="v todo">03 Proof</span><span class="v act">03 Proof</span><span class="v done"><i class="ic" data-i="check"></i>Proof</span></div>
              <b class="dash"></b>
              <div class="st" data-k="vector"><span class="v todo">04 Vector PDF</span><span class="v act">04 Vector PDF</span><span class="v done"><i class="ic" data-i="check"></i>Vector PDF</span></div>
            </div>
            <div class="dim" id="dim-top"></div>
          </div>

          <!-- Left: the order -->
          <div id="pL" class="panel">
            <div class="scroll" id="scrollL">
              <div class="sec" id="sec1">
                <div class="sh"><span class="num">01</span>Specification</div>
                <div class="lab">Paste the order specification</div>
                <div class="ta mono" id="specTa"><span id="specTxt"></span><span class="caret" id="specCaret"></span></div>
                <div class="btn navy" id="btnRead">Read specification</div>
                <div class="hr"></div>
                <div class="lab row">What the app understood <span class="chip amber" id="assumedCount">1 assumed</span></div>
                <div id="specRows"></div>
              </div>
              <div class="sec" id="sec2">
                <div class="sh"><span class="num">02</span>Customer wording <span class="btn ghost sm right" id="btnDocx"><i class="ic" data-i="file-text"></i>Word .docx</span></div>
                <div class="lab">Kept character for character</div>
                <div id="wordRows"></div>
              </div>
              <div class="sec" id="sec3">
                <div class="sh"><span class="num">03</span>Customer files</div>
                <div class="fbox" id="fPhotos">
                  <div class="fh">Photos <span class="mono mut">1 of 4</span><span class="add"><i class="ic" data-i="upload"></i>Add</span></div>
                  <div class="frow" id="photoRow"><img src="media/photo-couple.png" alt=""><div><div>1 photo.png</div><div class="mono mut sm">Full Color UV printed</div></div></div>
                </div>
                <div class="fbox"><div class="fh">Logos <span class="mono mut">0 of 6</span><span class="add"><i class="ic" data-i="upload"></i>Add</span></div></div>
                <div class="fbox"><div class="fh">Sketches <span class="mono mut">0 of 4</span><span class="add"><i class="ic" data-i="upload"></i>Add</span></div></div>
                <div class="fbox"><div class="fh">Exact design <span class="mono mut">0 of 1</span><span class="add"><i class="ic" data-i="upload"></i>Add</span></div></div>
              </div>
            </div>
            <div class="dim" id="dim-L"></div>
          </div>

          <!-- Centre: concepts -->
          <div id="pC" class="panel">
            <div class="cbar" id="cbar"></div>
            <div class="sh light"><span class="num">04</span>Concepts</div>
            <div class="csub">Two production-realistic layouts. Add up to 3 to the proof: each becomes its own page of one PDF.</div>
            <div class="btn stage" id="btnGen"><i class="ic" data-i="layers"></i>Generate 2 concepts</div>
            <div class="cards">
              <div class="card" id="cardA">
                <div class="ch">Classic <span class="onproof" id="onProof"><i class="ic" data-i="check"></i>On the proof</span></div>
                <div class="cd">Balanced, centered arrangement matching our standard recognition plaque proportions.</div>
                <div class="cimg" id="imgA">
                  <div class="pw lay"></div>
                  <div class="pw ren"></div>
                  <div class="pw ren2"></div>
                  <div class="scan"></div>
                  <div class="tag mono">Layout preview</div>
                  <div class="tick" id="tickA"><i class="ic" data-i="check"></i></div>
                </div>
                <div class="vers"><span class="vchip mono" id="vA1">v1 · original</span><span class="vchip mono" id="vA2">v2 · edit</span></div>
                <div class="spell" id="spellA"><i class="ic" data-i="circle-check"></i>Spelling matches the order</div>
                <div class="guided" id="guidedA"><i class="ic" data-i="book-open-check"></i>Guided by 3 Impact Signs examples</div>
                <div class="crow"><div class="btn use" id="useA"><span class="u1">Use this one</span><span class="u2"><i class="ic" data-i="check"></i>On the proof</span></div><div class="btn sq"><i class="ic" data-i="refresh-cw"></i></div></div>
                <div class="fix"><div class="fta" id="fixTa"><span class="ph" id="fixPh">Describe any change to this image</span><span id="fixTxt"></span><span class="caret" id="fixCaret"></span></div><div class="btn apply" id="btnApply">Apply</div></div>
                <div class="plan" id="plan">
                  <div class="pl-h mono">How the app read it</div>
                  <div class="pchip" id="pc1"><b>Image</b>A raised paw print each side of the photo</div>
                  <div class="pchip" id="pc2"><b>Kept</b>Wording, layout, finish and photo</div>
                </div>
              </div>
              <div class="card" id="cardB">
                <div class="ch">Statement</div>
                <div class="cd">Equal top columns: photo on the left, opening lines on the right, the rest across the bottom.</div>
                <div class="cimg" id="imgB">
                  <div class="pw lay"></div>
                  <div class="pw ren"></div>
                  <div class="scan"></div>
                  <div class="tag mono">Layout preview</div>
                </div>
                <div class="vers"><span class="vchip mono" id="vB1">v1 · original</span></div>
                <div class="spell" id="spellB"><i class="ic" data-i="circle-check"></i>Spelling matches the order</div>
                <div class="guided" id="guidedB"><i class="ic" data-i="book-open-check"></i>Guided by 3 Impact Signs examples</div>
                <div class="crow"><div class="btn use"><span class="u1">Add as page 2</span></div><div class="btn sq"><i class="ic" data-i="refresh-cw"></i></div></div>
                <div class="fix"><div class="fta"><span class="ph">Describe any change to this image</span></div><div class="btn apply">Apply</div></div>
              </div>
            </div>
            <div class="dim" id="dim-C"></div>
          </div>

          <!-- Right: outputs -->
          <div id="pR" class="panel">
            <div class="scroll" id="scrollR">
              <div class="sh"><span class="num">05</span>Customer proof</div>
              <div class="empty" id="emptyProof"><i class="ic" data-i="file-text"></i><b>Nothing on the proof yet</b><span>Press “Use this one” under a concept.</span></div>
              <div class="page1" id="page1"><div class="p1img"></div><div><div class="mono sm mut">Page 1</div><div>From Classic v2</div></div></div>
              <div class="lab">Description</div>
              <div class="desc">DESCRIPTION: Qty. 1 set 18”x24” 1/4” thick Cast Bronze Plaque. Satin brushed finish. Single line border. Background painted Dark Oxide with Leatherette texture.</div>
              <div class="btn navy wide" id="btnProof"><i class="ic" data-i="file-check"></i>Create proof PDF</div>
              <div class="file" id="proofFile">
                <div class="fn">Proof - 32885 - Classic v2.pdf <span class="chip latest">Latest</span></div>
                <div class="mono sm mut">From Classic v2</div>
                <div class="fthumb"><img src="media/proof-raccoon-concept.png" alt=""></div>
                <div class="crow"><div class="btn navy grow"><i class="ic" data-i="download"></i>Download</div><div class="btn ghost">Open</div></div>
              </div>
              <div class="sh" style="margin-top:22px"><span class="num">06</span>Vector production PDF</div>
              <div class="btn ghost wide" id="btnVec"><i class="ic" data-i="pen-tool"></i>Create vector PDF</div>
            </div>
            <div class="dim" id="dim-R"></div>
          </div>

          <!-- Pointer and click ripple live in window space so they ride the camera -->
          <div id="ripple"></div>
          <svg id="cursor" width="26" height="30" viewBox="0 0 26 30"><path d="M2 2 L2 24 L8 18.5 L12.2 27.5 L16 25.8 L11.9 17 L20 17 Z" fill="#111" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>
        </div>
      </div>
    </div>

    <!-- Captions -->
    <div class="cap" id="cap0"><div class="cstep mono">The workspace</div><div class="ch1">One screen. Order to foundry.</div></div>
    <div class="cap right" id="cap1">
      <div class="cstep mono"><b>01</b> Read the order</div>
      <div class="ch1">Paste the order.<br>The spec fills itself in.</div>
      <div class="cp">Every option comes from your catalog. Anything the order didn’t state is flagged <span class="chip amber inl">Assumed</span> so you can check it.</div>
    </div>
    <div class="cap right" id="cap2">
      <div class="cstep mono"><b>02</b> Customer wording</div>
      <div class="ch1">Character for character.</div>
      <div class="cp">Drop in the Word file. Every quote mark, dash and capital is kept exactly as the customer sent it. Never autocorrected.</div>
      <div class="glyphs"><span class="gl"><b>“</b><i class="mono">curly quote</i></span><span class="gl"><b>’</b><i class="mono">apostrophe</i></span><span class="gl"><b>—</b><i class="mono">em dash</i></span></div>
    </div>
    <div class="cap right" id="cap3">
      <div class="cstep mono"><b>03</b> Concepts</div>
      <div class="ch1">Two photoreal concepts in about a minute.</div>
      <div class="cp">Classic and Statement, rendered from the exact layout, guided by real Impact Signs work, then spell-checked against the order.</div>
    </div>
    <div class="cap right" id="cap4">
      <div class="cstep mono"><b>04</b> Fix</div>
      <div class="ch1">Ask for changes in plain English.</div>
      <div class="cp">Small or large, several at once. Only what you ask for changes, and nothing is overwritten: every version is kept.</div>
    </div>
    <div class="cap" id="cap5">
      <div class="cstep mono"><b>05</b> Customer proof</div>
      <div class="ch1">One click to a customer-ready proof.</div>
      <div class="cp">Up to three concepts, each its own page of one PDF.</div>
    </div>
  </section>

  <!-- 5 · Proof -->
  <section id="s-proof" class="scene">
    <div id="proofBig"><img src="media/proof-raccoon-concept.png" alt=""><div id="anns"></div></div>
    <div id="proofNotes"></div>
    <div class="cap" id="capProof"><div class="cstep mono"><b>05</b> Customer proof</div><div class="ch1">Measured from real Impact Signs proofs.</div></div>
  </section>

  <!-- 6 · Vector -->
  <section id="s-vector" class="scene">
    <div id="vecTag" class="mono"><span id="vt1">Concept · Classic v2</span><span id="vt2">Vector production PDF · 18 × 24 in</span></div>
    <div id="vecBox">
      <img id="vecA" src="media/concept-classic.jpg" alt="">
      <div id="vecBclip"><img id="vecB" src="media/vector-raccoon-1.png" alt=""></div>
      
    </div>
    <div id="vecText">
      <div class="cstep mono"><b>06</b> Production file</div>
      <div class="ch1">A production file, not a picture.</div>
      <div class="cp">One ink at full plaque size. Every letter outlined. Opens straight in Illustrator.</div>
      <div id="pre">
        <div class="pre-h mono"><i class="ic" data-i="shield-check"></i>Preflight</div>
      </div>
    </div>
  </section>

  <!-- 7 · One engine -->
  <section id="s-engine" class="scene">
    <div class="kt" id="eng-h"><div class="ln">One layout engine.</div><div class="ln dim2">Three files that always agree.</div></div>
    <svg id="eng-lines" width="1920" height="1080"></svg>
    <div id="eng-core"><i class="ic" data-i="ruler"></i><b>Layout engine</b><span class="mono">Exact geometry</span></div>
    <div class="eng-out" id="eo1"><div class="eo-img"><div class="pw ren"></div></div><b>Concept image</b><span class="mono">For the customer</span></div>
    <div class="eng-out" id="eo2"><div class="eo-img wide"><img src="media/proof-raccoon-concept.png" alt=""></div><b>Customer proof</b><span class="mono">For approval</span></div>
    <div class="eng-out" id="eo3"><div class="eo-img"><img src="media/vector-raccoon-1.png" alt=""></div><b>Vector production PDF</b><span class="mono">For the foundry</span></div>
  </section>

  <!-- 8 · Toolkit -->
  <section id="s-tools" class="scene">
    <div class="kt" id="tools-h"><div class="ln">And everything around it.</div></div>
    <div id="bento"></div>
  </section>

  <!-- 9 · Benefits -->
  <section id="s-ben" class="scene">
    <div class="kt center ben" id="ben1"><div class="ln">No retyping.</div></div>
    <div class="kt center ben" id="ben2"><div class="ln">No redrawing.</div></div>
    <div class="kt center ben" id="ben3"><div class="ln">No files that disagree.</div></div>
  </section>

  <!-- 10 · Gallery -->
  <section id="s-gal" class="scene">
    <div id="galWrap"><div id="galPlane"></div></div>
    <div id="galVeil"></div>
    <div class="kt center" id="gal-t"><div class="ln">Built for the people</div><div class="ln">who make <em class="bz">bronze</em> last.</div></div>
  </section>

  <!-- 11 · End card -->
  <section id="s-end" class="scene">
    <div id="endBox">
      <img src="media/logo.png" id="endLogo" alt="">
      <div id="endName">Plaque Proof Studio</div>
      <div id="endRule"></div>
      <div id="endTag">From order to foundry, in one place.</div>
      <div id="endUrl" class="mono">impactsigns.com</div>
    </div>
  </section>

  <div id="flash" class="layer"></div>
</div>

`;
