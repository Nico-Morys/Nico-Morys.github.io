// Fetch predictions for multiple events
const events = ['ufc308', 'ufc309', 'ufc310', 'ufconespncovingtonvsbuckley', 'ufc311', 'ufc313', 'ufc315']; // Add your events here

events.forEach(event => {
    fetch(`${event}-predictions.json`)  // Assuming each event has its own JSON file
        .then(response => response.json())
        .then(predictions => {
            const tableBody = document.querySelector(`#${event}-table`);

            predictions.forEach(prediction => {
                const row = document.createElement("tr");

                // Manually set Status based on result
                let statusImage = '';

                if (prediction.result === 'win') {
                    // If result is win, show green checkmark
                    statusImage = 'images/green-check.png';
                } else if (prediction.result === 'loss') {
                    // If result is loss, show red X mark
                    statusImage = 'images/red-x.png';
                } else {
                    // Optionally, handle cases where the result isn't set
                    statusImage = 'images/unknown.png'; // Default to red X if no result is available
                }

                row.innerHTML = `
                    <td>${prediction.fight}</td>
                    <td>${prediction.predicted_winner}</td>
                    <td>${prediction.confidence}</td>
                    <td><img src="${statusImage}" alt="Status" width="20" height="20"></td>
                `;

                tableBody.appendChild(row);
            });
        })
        .catch(error => console.error("Error loading predictions:", error));
});

// Toggle the visibility of the dropdown content
function toggleDropdown(id) {
    const dropdown = document.getElementById(id);
    dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
}