-- Tenant-to-Landlord Communication and Maintenance Request System (Abuja)
-- Implements Tables 3.3 - 3.8. Three columns were added to Users (failed_attempts,
-- locked_until, reset_token/reset_expires) to support account lockout and password reset (UT-02),
-- and photo_path to MaintenanceRequests for the optional photo attachment.
CREATE DATABASE IF NOT EXISTS tenant_landlord CHARACTER SET utf8mb4;
USE tenant_landlord;
SET FOREIGN_KEY_CHECKS=0;
DROP TABLE IF EXISTS Notifications, Messages, MaintenanceRequests, Tenancies, Properties, Users;
SET FOREIGN_KEY_CHECKS=1;

CREATE TABLE Users (
  user_id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  phone VARCHAR(15) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('Tenant','Landlord','Maintenance Staff') NOT NULL,
  failed_attempts INT NOT NULL DEFAULT 0,
  locked_until DATETIME NULL,
  reset_token VARCHAR(100) NULL,
  reset_expires DATETIME NULL
) ENGINE=InnoDB;

CREATE TABLE Properties (
  property_id INT PRIMARY KEY AUTO_INCREMENT,
  landlord_id INT NOT NULL,
  address VARCHAR(255) NOT NULL,
  unit_details VARCHAR(255) NULL,
  FOREIGN KEY (landlord_id) REFERENCES Users(user_id)
) ENGINE=InnoDB;

CREATE TABLE Tenancies (
  tenancy_id INT PRIMARY KEY AUTO_INCREMENT,
  tenant_id INT NOT NULL,
  property_id INT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NULL,
  status ENUM('Active','Ended','Pending') NOT NULL DEFAULT 'Active',
  FOREIGN KEY (tenant_id) REFERENCES Users(user_id),
  FOREIGN KEY (property_id) REFERENCES Properties(property_id)
) ENGINE=InnoDB;

CREATE TABLE MaintenanceRequests (
  request_id INT PRIMARY KEY AUTO_INCREMENT,
  tenancy_id INT NOT NULL,
  category VARCHAR(50) NOT NULL,
  description TEXT NOT NULL,
  severity ENUM('Low','Medium','High','Urgent') NOT NULL,
  status ENUM('Received','In Progress','Resolved','Closed') NOT NULL DEFAULT 'Received',
  date_submitted DATETIME NOT NULL,
  date_resolved DATETIME NULL,
  assigned_to INT NULL,
  photo_path VARCHAR(255) NULL,
  FOREIGN KEY (tenancy_id) REFERENCES Tenancies(tenancy_id),
  FOREIGN KEY (assigned_to) REFERENCES Users(user_id),
  INDEX idx_status (status),
  INDEX idx_submitted (date_submitted)
) ENGINE=InnoDB;

CREATE TABLE Messages (
  message_id INT PRIMARY KEY AUTO_INCREMENT,
  request_id INT NULL,
  sender_id INT NOT NULL,
  receiver_id INT NOT NULL,
  content TEXT NOT NULL,
  timestamp DATETIME NOT NULL,
  FOREIGN KEY (request_id) REFERENCES MaintenanceRequests(request_id),
  FOREIGN KEY (sender_id) REFERENCES Users(user_id),
  FOREIGN KEY (receiver_id) REFERENCES Users(user_id)
) ENGINE=InnoDB;

CREATE TABLE Notifications (
  notification_id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  message VARCHAR(255) NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  timestamp DATETIME NOT NULL,
  FOREIGN KEY (user_id) REFERENCES Users(user_id),
  INDEX idx_user_read (user_id, is_read)
) ENGINE=InnoDB;
