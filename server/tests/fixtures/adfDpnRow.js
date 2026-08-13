'use strict';

// Replicates ASIC Connect's ADF DPN table structure:
//   col 0  — checkbox (select)
//   col 1  — name cell: 2 hidden spans [DPN#, fullName] + visible link
//   col 2  — visible given name(s) text
//   col 3  — type ("Disqualified Person Notice" etc.)
//   col 4  — order/commenced date
//   col 5  — expiry/ceased date
//   col 6  — address
function row(dpnNo, fullName, typeText, commenced, expiry, address) {
  return `
  <tr>
    <td><input type="checkbox" /></td>
    <td>
      <span style="display:none">${dpnNo}</span>
      <span style="display:none">${fullName}</span>
      <a href="#">View</a>
    </td>
    <td>${fullName}</td>
    <td>${typeText}</td>
    <td>${commenced}</td>
    <td>${expiry}</td>
    <td>${address}</td>
  </tr>`;
}

function table(...rows) {
  return `<table><tbody>${rows.join('')}</tbody></table>`;
}

module.exports = { row, table };
