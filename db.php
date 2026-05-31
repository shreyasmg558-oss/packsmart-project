<?php
$conn = mysqli_connect("localhost", "root", "", "packsmart");
if (!$conn) {
    die("DB Error: " . mysqli_connect_error());
}
?>