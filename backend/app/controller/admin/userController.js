import handleResponse from "../../utils/helper.js";
import getPagination from "../../utils/pagination.js";
import {
  getUserByIdData,
  getUsersData,
  createUserData,
} from "../../services/admin/userAdminService.js";

export const getUsers = async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req, {
      defaultLimit: 25,
      maxLimit: 200,
    });

    const data = await getUsersData({ page, limit, skip });
    return handleResponse(res, 200, "Users fetched successfully", data);
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

export const getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await getUserByIdData(id);

    if (!user) {
      return handleResponse(res, 404, "Customer not found");
    }

    return handleResponse(
      res,
      200,
      "Customer details fetched successfully",
      user,
    );
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

export const createUser = async (req, res) => {
  try {
    const { name, email, phone, status } = req.body || {};
    if (!phone || !phone.trim()) {
      return handleResponse(res, 400, "Phone number is required");
    }
    const data = await createUserData({ name, email, phone, status });
    return handleResponse(res, 201, "Customer created successfully", data);
  } catch (error) {
    if (error.code === 11000 || error.message?.includes("E11000") || error.message?.includes("duplicate key")) {
      if (error.message?.includes("phone") || error.keyPattern?.phone) {
        return handleResponse(res, 400, "Customer with this phone number already exists");
      }
      if (error.message?.includes("email") || error.keyPattern?.email) {
        return handleResponse(res, 400, "Customer with this email address already exists");
      }
      return handleResponse(res, 400, "A customer with this information already exists");
    }
    return handleResponse(res, 400, error.message);
  }
};
