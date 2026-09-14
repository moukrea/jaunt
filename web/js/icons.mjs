const paths = {
 terminal:'m5 6 6 6-6 6 M13 18h6', plus:'M12 5v14 M5 12h14', close:'m6 6 12 12 M18 6 6 18',
 chevron:'m9 5 7 7-7 7', down:'m6 9 6 6 6-6', menu:'M4 6h16 M4 12h16 M4 18h16',
 monitor:'M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z M8 21h8 M12 17v4',
 folder:'M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7z',
 file:'M13 3H5v18h14V9z M13 3v6h6', image:'M3 3h18v18H3z M3 16l5-5 4 4 3-3 6 6 M16 7h.01',
 upload:'M12 16V3 m-5 5 5-5 5 5 M4 16v5h16v-5', download:'M12 3v13 m-5-5 5 5 5-5 M4 17v4h16v-4',
 copy:'M9 9h12v12H9z M15 5V3H3v12h2', paste:'M9 3h6v4H9z M9 5H5v16h14V5h-4',
 attach:'m8 12 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9', lock:'M5 10h14v11H5z M8 10V6a4 4 0 0 1 8 0v4 M12 14v3',
 shield:'m12 3 9 4v6c0 5-9 9-9 9s-9-4-9-9V7z m-4 9 3 3 5-5',
 qr:'M3 3h6v6H3z M15 3h6v6h-6z M3 15h6v6H3z M15 15h3v3h3v3h-6z',
 settings:'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z M12 2v3 M12 19v3 M2 12h3 M19 12h3 m-17-7 2 2 m10 10 2 2 M5 19l2-2 M17 7l2-2',
 bell:'M6 8a6 6 0 0 1 12 0v7l2 3H4l2-3z M9 21h6', check:'m5 12 4 4L19 6',
 refresh:'M20 7V2m0 5h-5 M4 17v5m0-5h5 M19 6A8 8 0 0 0 5 5 M5 18a8 8 0 0 0 14 1',
 arrowUp:'M12 20V4 m-7 7 7-7 7 7', arrowDown:'M12 4v16 m-7-7 7 7 7-7',
 arrowLeft:'M20 12H4 m7-7-7 7 7 7', arrowRight:'M4 12h16 m-7-7 7 7-7 7',
 trash:'M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7',
 edit:'m15 3 6 6-12 12H3v-6z M12 6l6 6', keyboard:'M2 5h20v14H2z M6 9h.01 M10 9h.01 M14 9h.01 M18 9h.01 M6 13h.01 M10 13h8',
 more:'M5 12h.01 M12 12h.01 M19 12h.01', external:'M14 3h7v7 M21 3 11 13 M10 3H3v18h18v-7',
 eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
 bolt:'m13 2-9 12h7l-1 8 10-13h-7z', search:'M10 3a7 7 0 1 1 0 14 7 7 0 0 1 0-14z m5 12 6 6',
 logout:'M9 3H3v18h6 M10 12h11 m-4-4 4 4-4 4', alert:'m12 3 10 18H2z M12 9v5 M12 17h.01',
 transfer:'M7 3v18 m-4-4 4 4 4-4 M17 21V3 m-4 4 4-4 4 4', sun:'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z M12 2v2 M12 20v2 M2 12h2 M20 12h2',
};
export function icon(name, size=20) {
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  for(const [k,v] of Object.entries({viewBox:'0 0 24 24',width:size,height:size,fill:'none',stroke:'currentColor','stroke-width':1.7,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'})) svg.setAttribute(k,String(v));
  const p=document.createElementNS(svg.namespaceURI,'path'); p.setAttribute('d',paths[name]||paths.terminal); svg.append(p); return svg;
}
export function fillIcons(root=document) { for(const e of root.querySelectorAll('[data-icon]')) { e.replaceChildren(icon(e.dataset.icon, Number(e.dataset.size)||20)); } }
