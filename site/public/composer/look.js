// Applies Composer's saved look before the page draws, so it never flashes the wrong paper.
(function () {
  var look = "auto";
  try {
    look = localStorage.getItem("vxd-composer-look") || "auto";
  } catch (error) {}
  if (!/^(auto|paper|sepia|night|slate|contrast)$/.test(look)) look = "auto";
  var root = document.documentElement;
  root.dataset.look = look;
  root.dataset.theme = look === "auto" ? "system" : look === "night" || look === "slate" ? "dark" : "light";
})();
